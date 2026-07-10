import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

export type WorkflowStepKind = "workflow" | "sequence" | "parallel" | "loop" | "task" | "dynamic-task-set"

export type WorkflowStep = {
  id: string
  kind: WorkflowStepKind
  label: string
  detail?: string
  sourceLine?: number
  meta?: Record<string, string | number | boolean | string[]>
  children?: WorkflowStep[]
}

export type WorkflowGraph = {
  id: string
  title: string
  sourcePath: string
  sourceHash: string
  sourceLines: number
  stats: {
    taskCount: number
    dynamicTaskSets: number
    loops: number
    parallelBranches: number
    outputTypes: string[]
    agents: string[]
  }
  tree: WorkflowStep
}

export type ClassifierRoute = {
  trigger: string
  mode: string
  workflow: string
  requiresTable: boolean
  confidence: string
}

export type WorkflowCatalog = {
  generatedAt: string
  repoRoot: string
  workflowSourceDir: string
  workflows: WorkflowGraph[]
  classifierRoutes: ClassifierRoute[]
  classifierSourcePath: string
}

type StaticCollection = {
  name: string
  count: number
  labels: string[]
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const workflowSourceDir = join(repoRoot, "packages/workflows/src")
const classifierSourcePath = join(repoRoot, "packages/backend/src/mode-classifier.ts")

export function buildWorkflowCatalog(): WorkflowCatalog {
  const workflowFiles = readdirSync(workflowSourceDir)
    .filter((file) => file.endsWith(".workflow.tsx"))
    .sort((left, right) => workflowSortKey(left).localeCompare(workflowSortKey(right)))

  return {
    generatedAt: new Date().toISOString(),
    repoRoot,
    workflowSourceDir,
    workflows: workflowFiles.map((file) => parseWorkflowFile(join(workflowSourceDir, file))),
    classifierRoutes: parseClassifierRoutes(),
    classifierSourcePath: relative(repoRoot, classifierSourcePath),
  }
}

function parseWorkflowFile(filePath: string): WorkflowGraph {
  const source = readFileSync(filePath, "utf8")
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const collections = collectStaticCollections(sourceFile)
  const workflowElement = findWorkflowElement(sourceFile)
  const fallbackName = basename(filePath).replace(/\.workflow\.tsx$/, "")
  const tree = workflowElement
    ? parseJsxElement(workflowElement, sourceFile, collections, fallbackName)
    : {
        id: fallbackName,
        kind: "workflow" as const,
        label: titleize(fallbackName),
        detail: "Workflow JSX was not found.",
        children: [],
      }
  const stats = collectStats(tree)

  return {
    id: String(tree.meta?.name ?? fallbackName),
    title: titleize(String(tree.meta?.name ?? fallbackName)),
    sourcePath: relative(repoRoot, filePath),
    sourceHash: createHash("sha256").update(source).digest("hex").slice(0, 12),
    sourceLines: source.split("\n").length,
    stats,
    tree,
  }
}

function findWorkflowElement(sourceFile: ts.SourceFile) {
  let match: ts.JsxElement | undefined

  function visit(node: ts.Node) {
    if (!match && ts.isJsxElement(node) && jsxTagName(node.openingElement.tagName) === "Workflow") {
      match = node
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return match
}

function parseJsxElement(
  element: ts.JsxElement,
  sourceFile: ts.SourceFile,
  collections: Map<string, StaticCollection>,
  fallbackId: string,
): WorkflowStep {
  const tag = jsxTagName(element.openingElement.tagName)
  const props = readProps(element.openingElement.attributes)
  const sourceLine = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile)).line + 1
  const name = cleanExpression(props.name ?? props.id ?? fallbackId)
  const id = slugify(name || `${tag}-${sourceLine}`)
  const children = parseChildren(element.children, sourceFile, collections, id)

  if (tag === "Workflow") {
    return {
      id,
      kind: "workflow",
      label: titleize(name || fallbackId),
      sourceLine,
      meta: { name: name || fallbackId },
      children,
    }
  }

  if (tag === "Sequence") {
    return {
      id: `${id}-sequence-${sourceLine}`,
      kind: "sequence",
      label: "Sequence",
      detail: "Runs children in order",
      sourceLine,
      children,
    }
  }

  if (tag === "Parallel") {
    return {
      id: `${id}-parallel-${sourceLine}`,
      kind: "parallel",
      label: "Parallel fan-out",
      detail: props.maxConcurrency ? `max concurrency ${cleanExpression(props.maxConcurrency)}` : "Runs branches concurrently",
      sourceLine,
      meta: {
        maxConcurrency: cleanExpression(props.maxConcurrency ?? ""),
      },
      children,
    }
  }

  if (tag === "Loop") {
    return {
      id: `${id}-loop-${sourceLine}`,
      kind: "loop",
      label: titleize(name || "Loop"),
      detail: "Repeats until its stop condition or iteration cap is reached",
      sourceLine,
      meta: {
        until: cleanExpression(props.until ?? ""),
        maxIterations: cleanExpression(props.maxIterations ?? ""),
        onMaxReached: cleanExpression(props.onMaxReached ?? ""),
      },
      children,
    }
  }

  if (tag === "Task") {
    const taskId = cleanExpression(props.id ?? `task-${sourceLine}`)
    const output = outputName(props.output)
    const agent = agentName(props.agent)
    return {
      id: slugify(taskId || `task-${sourceLine}`),
      kind: "task",
      label: titleize(taskId || "Task"),
      detail: [agent, output ? `writes ${output}` : ""].filter(Boolean).join(" · "),
      sourceLine,
      meta: {
        taskId,
        output: output ?? "",
        agent: agent ?? "",
        needs: cleanExpression(props.needs ?? ""),
      },
    }
  }

  return {
    id: `${slugify(tag)}-${sourceLine}`,
    kind: "task",
    label: tag,
    sourceLine,
    children,
  }
}

function parseChildren(
  children: ts.NodeArray<ts.JsxChild>,
  sourceFile: ts.SourceFile,
  collections: Map<string, StaticCollection>,
  parentId: string,
) {
  const steps: WorkflowStep[] = []

  for (const child of children) {
    if (ts.isJsxElement(child)) {
      const tag = jsxTagName(child.openingElement.tagName)
      if (isWorkflowTag(tag)) {
        steps.push(parseJsxElement(child, sourceFile, collections, parentId))
      }
      continue
    }

    if (ts.isJsxExpression(child) && child.expression) {
      steps.push(...parseExpressionSteps(child.expression, sourceFile, collections, parentId))
    }
  }

  return steps
}

function parseExpressionSteps(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  collections: Map<string, StaticCollection>,
  parentId: string,
): WorkflowStep[] {
  if (ts.isJsxElement(expression)) {
    const tag = jsxTagName(expression.openingElement.tagName)
    return isWorkflowTag(tag) ? [parseJsxElement(expression, sourceFile, collections, parentId)] : []
  }

  if (ts.isParenthesizedExpression(expression)) {
    return parseExpressionSteps(expression.expression, sourceFile, collections, parentId)
  }

  if (ts.isConditionalExpression(expression)) {
    return [
      ...parseExpressionSteps(expression.whenTrue, sourceFile, collections, parentId),
      ...parseExpressionSteps(expression.whenFalse, sourceFile, collections, parentId),
    ]
  }

  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    return [
      ...parseExpressionSteps(expression.left, sourceFile, collections, parentId),
      ...parseExpressionSteps(expression.right, sourceFile, collections, parentId),
    ]
  }

  const dynamic = parseDynamicTaskSet(expression, sourceFile, collections)
  return dynamic ? [dynamic] : []
}

function parseDynamicTaskSet(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  collections: Map<string, StaticCollection>,
): WorkflowStep | undefined {
  if (!ts.isCallExpression(expression)) {
    return undefined
  }

  const callTarget = expression.expression
  if (!ts.isPropertyAccessExpression(callTarget) || callTarget.name.text !== "map") {
    return undefined
  }

  const collectionName = callTarget.expression.getText(sourceFile)
  const callback = expression.arguments[0]
  const returned = callback && returnedJsxFromMapCallback(callback)
  if (!returned || jsxTagName(returned.openingElement.tagName) !== "Task") {
    return undefined
  }

  const props = readProps(returned.openingElement.attributes)
  const sourceLine = sourceFile.getLineAndCharacterOfPosition(returned.getStart(sourceFile)).line + 1
  const idPattern = cleanExpression(props.id ?? `${collectionName}.item`)
  const collection = collections.get(collectionName)
  const output = outputName(props.output)
  const agent = agentName(props.agent)

  return {
    id: `dynamic-${slugify(collectionName)}-${sourceLine}`,
    kind: "dynamic-task-set",
    label: titleize(collectionName),
    detail: [
      collection ? `${collection.count} generated tasks` : "runtime-generated tasks",
      agent,
      output ? `writes ${output}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    sourceLine,
    meta: {
      mapSource: collectionName,
      cardinality: collection?.count ?? "runtime",
      idPattern,
      labels: collection?.labels ?? [],
      output: output ?? "",
      agent: agent ?? "",
    },
  }
}

function returnedJsxFromMapCallback(node: ts.Node): ts.JsxElement | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (ts.isJsxElement(node.body)) {
      return node.body
    }
    if (ts.isParenthesizedExpression(node.body) && ts.isJsxElement(node.body.expression)) {
      return node.body.expression
    }
    if (ts.isBlock(node.body)) {
      for (const statement of node.body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          if (ts.isJsxElement(statement.expression)) {
            return statement.expression
          }
          if (ts.isParenthesizedExpression(statement.expression) && ts.isJsxElement(statement.expression.expression)) {
            return statement.expression.expression
          }
        }
      }
    }
  }

  return undefined
}

function collectStaticCollections(sourceFile: ts.SourceFile) {
  const collections = new Map<string, StaticCollection>()

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
        continue
      }

      const labels = declaration.initializer.elements.map((item, index) => collectionItemLabel(item, sourceFile, index))
      collections.set(declaration.name.text, {
        name: declaration.name.text,
        count: declaration.initializer.elements.length,
        labels,
      })
    }
  }

  return collections
}

function collectionItemLabel(item: ts.Expression, sourceFile: ts.SourceFile, index: number) {
  if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) {
    return item.text
  }

  if (ts.isObjectLiteralExpression(item)) {
    const label = readObjectString(item, "label") ?? readObjectString(item, "id")
    if (label) {
      return label
    }
  }

  return `item ${index + 1}`
}

function readObjectString(object: ts.ObjectLiteralExpression, key: string) {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
    if (name === key && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer))) {
      return property.initializer.text
    }
  }
  return undefined
}

function readProps(attributes: ts.JsxAttributes) {
  const props: Record<string, string> = {}

  for (const property of attributes.properties) {
    if (!ts.isJsxAttribute(property)) {
      continue
    }

    const name = property.name.getText()
    if (!property.initializer) {
      props[name] = "true"
    } else if (ts.isStringLiteral(property.initializer)) {
      props[name] = property.initializer.text
    } else if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
      props[name] = property.initializer.expression.getText()
    }
  }

  return props
}

function parseClassifierRoutes(): ClassifierRoute[] {
  if (!existsSync(classifierSourcePath)) {
    return []
  }

  const source = readFileSync(classifierSourcePath, "utf8")
  const workflowUnion = Array.from(source.matchAll(/workflow:\s*\n([\s\S]*?);/g))[0]?.[1] ?? ""
  const explicitWorkflows = Array.from(workflowUnion.matchAll(/\|\s*"([^"]+)"/g)).map((match) => match[1])

  const routes: ClassifierRoute[] = explicitWorkflows
    .filter((workflow) => workflow !== "codex-smoke")
    .map((workflow) => ({
      trigger: `Explicit workflow=${workflow}`,
      mode: workflow.endsWith("-forecast") ? "forecast" : modeForWorkflow(workflow),
      workflow,
      requiresTable: ["agent-map", "rank", "merge", "dedupe"].includes(workflow),
      confidence: "1.00",
    }))

  routes.push(
    {
      trigger: "Prompt mentions duplicates / near duplicates",
      mode: "dedupe",
      workflow: "dedupe",
      requiresTable: true,
      confidence: "0.68",
    },
    {
      trigger: "Prompt asks to merge, join, reconcile, or match records",
      mode: "merge",
      workflow: "merge",
      requiresTable: true,
      confidence: "0.68",
    },
    {
      trigger: "Prompt asks to rank, prioritize, or order rows",
      mode: "rank",
      workflow: "rank",
      requiresTable: true,
      confidence: "0.68",
    },
    {
      trigger: "Prompt asks to classify, categorize, label, or tag",
      mode: "classify",
      workflow: "agent-map",
      requiresTable: true,
      confidence: "0.68",
    },
    {
      trigger: "Prompt looks like a future forecast",
      mode: "forecast",
      workflow: "forecast-type router",
      requiresTable: false,
      confidence: "0.74",
    },
    {
      trigger: "Open-ended non-table prompt",
      mode: "multi_agent",
      workflow: "deep-research",
      requiresTable: false,
      confidence: "0.68",
    },
  )

  return routes
}

function collectStats(tree: WorkflowStep) {
  const outputTypes = new Set<string>()
  const agents = new Set<string>()
  let taskCount = 0
  let dynamicTaskSets = 0
  let loops = 0
  let parallelBranches = 0

  function visit(step: WorkflowStep) {
    if (step.kind === "task") {
      taskCount += 1
    }
    if (step.kind === "dynamic-task-set") {
      dynamicTaskSets += 1
    }
    if (step.kind === "loop") {
      loops += 1
    }
    if (step.kind === "parallel") {
      parallelBranches += step.children?.length ?? 0
    }
    const output = String(step.meta?.output ?? "")
    const agent = String(step.meta?.agent ?? "")
    if (output) {
      outputTypes.add(output)
    }
    if (agent) {
      agents.add(agent)
    }
    step.children?.forEach(visit)
  }

  visit(tree)

  return {
    taskCount,
    dynamicTaskSets,
    loops,
    parallelBranches,
    outputTypes: Array.from(outputTypes).sort(),
    agents: Array.from(agents).sort(),
  }
}

function workflowSortKey(file: string) {
  const priority = [
    "deep-research.workflow.tsx",
    "binary-forecast.workflow.tsx",
    "numeric-forecast.workflow.tsx",
    "date-forecast.workflow.tsx",
    "categorical-forecast.workflow.tsx",
    "thresholded-forecast.workflow.tsx",
    "conditional-forecast.workflow.tsx",
    "agent-map.workflow.tsx",
    "rank.workflow.tsx",
    "merge.workflow.tsx",
    "dedupe.workflow.tsx",
  ]
  const index = priority.indexOf(file)
  return `${String(index === -1 ? 99 : index).padStart(2, "0")}-${file}`
}

function modeForWorkflow(workflow: string) {
  if (workflow === "deep-research") {
    return "multi_agent"
  }
  if (workflow === "agent-map") {
    return "agent_map"
  }
  return workflow
}

function isWorkflowTag(tag: string) {
  return ["Workflow", "Sequence", "Parallel", "Loop", "Task"].includes(tag)
}

function jsxTagName(name: ts.JsxTagNameExpression) {
  return name.getText().split(".").at(-1) ?? name.getText()
}

function outputName(value?: string) {
  if (!value) {
    return undefined
  }
  return cleanExpression(value).replace(/^outputs\./, "")
}

function agentName(value?: string) {
  if (!value) {
    return undefined
  }
  return titleize(cleanExpression(value).replace(/^codex/, "").replace(/Agent$/, " agent"))
}

function cleanExpression(value: string) {
  return value
    .replaceAll("`", "")
    .replaceAll('"', "")
    .replaceAll("'", "")
    .replace(/\s+/g, " ")
    .trim()
}

function titleize(value: string) {
  const withSpaces = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return withSpaces.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || "workflow-step"
}

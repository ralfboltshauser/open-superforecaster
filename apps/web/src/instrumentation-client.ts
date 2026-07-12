import { installBrowserLogForwarder } from "./lib/browser-log-forwarder"

try {
  installBrowserLogForwarder()
} catch {
  // Client instrumentation must not prevent hydration.
}

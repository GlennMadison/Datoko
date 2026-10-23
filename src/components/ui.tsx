import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) { return <section className={`card ${className}`} {...props}>{children}</section>; }
export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button className={`button ${className}`} {...props} />; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "orange" | "red" }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { COMPLETED: "Completed", READY_TO_SHIP: "Ready to ship", SHIPPED: "Shipped", CANCELLED: "Cancelled", CONNECTED: "Connected", NOT_CONNECTED: "Not connected", RECONNECT_REQUIRED: "Reconnect required", DISCONNECTED: "Disconnected", SUCCEEDED: "Succeeded", RUNNING: "Running", QUEUED: "Queued", RETRYING: "Retrying", FAILED: "Failed", RESOLVED: "Resolved" };
  const tone = ["COMPLETED", "CONNECTED", "SUCCEEDED", "RESOLVED"].includes(value) ? "green" : ["CANCELLED", "FAILED", "RECONNECT_REQUIRED"].includes(value) ? "red" : ["READY_TO_SHIP", "RUNNING", "RETRYING"].includes(value) ? "orange" : "neutral";
  return <Badge tone={tone}>{labels[value] ?? value.replaceAll("_", " ").toLowerCase()}</Badge>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><h3>{title}</h3><p>{children}</p></div>;
}
export function PageHeading({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>;
}
export function Metric({ label, value, note, featured = false, testId }: { label: string; value: ReactNode; note: string; featured?: boolean; testId?: string }) {
  return <div className={`metric ${featured ? "metric-featured" : ""}`}><dt>{label}</dt><dd className="metric-value numeric" data-testid={testId}>{value}</dd><dd className="metric-note">{note}</dd></div>;
}

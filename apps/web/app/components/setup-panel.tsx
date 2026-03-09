import { Link } from "react-router";

type SetupPanelProps = {
  title: string;
  copy: string;
  actionLabel?: string;
  actionHref?: string;
};

export function SetupPanel({
  title,
  copy,
  actionLabel = "Open diagnostics",
  actionHref = "/diagnostics",
}: SetupPanelProps) {
  return (
    <section className="route-panel">
      <p className="eyebrow">Setup required</p>
      <h1 className="panel-title">{title}</h1>
      <p className="panel-copy">{copy}</p>
      <div className="hero-actions">
        <Link className="button button-primary" to={actionHref}>
          {actionLabel}
        </Link>
      </div>
    </section>
  );
}

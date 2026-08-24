// These are currently visual affordances; view switching is not wired yet.
const activityIcons = [
  "codicon-files",
  "codicon-search",
  "codicon-source-control",
  "codicon-run-all",
  "codicon-extensions",
];

export function ActivityBar() {
  return (
    <nav class="activity-bar" aria-label="Activity Bar">
      <div class="activity-items">
        {activityIcons.map((icon, index) => (
          <span
            class={`activity-icon ${index === 0 ? "is-active" : ""}`}
            aria-hidden="true"
          >
            <span class={`codicon ${icon}`} />
          </span>
        ))}
      </div>
      <div class="activity-items activity-items-bottom" aria-hidden="true">
        <span class="activity-icon">
          <span class="codicon codicon-account" />
        </span>
        <span class="activity-icon">
          <span class="codicon codicon-settings-gear" />
        </span>
      </div>
    </nav>
  );
}

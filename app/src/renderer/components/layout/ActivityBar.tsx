export type ActivityView =
  | "explorer"
  | "search"
  | "source-control"
  | "run-and-debug"
  | "extensions"
  | "accounts"
  | "manage";

type ActivityItem = {
  id: ActivityView;
  icon: string;
  label: string;
};

const activityItems: ActivityItem[] = [
  { id: "explorer", icon: "codicon-files", label: "Explorer" },
  { id: "search", icon: "codicon-search", label: "Search" },
  {
    id: "source-control",
    icon: "codicon-source-control",
    label: "Source Control",
  },
  { id: "run-and-debug", icon: "codicon-run-all", label: "Run and Debug" },
  { id: "extensions", icon: "codicon-extensions", label: "Extensions" },
];

const bottomActivityItems: ActivityItem[] = [
  { id: "accounts", icon: "codicon-account", label: "Accounts" },
  { id: "manage", icon: "codicon-settings-gear", label: "Manage" },
];

export type ActivityBarProps = {
  selected: ActivityView;
  onSelect: (view: ActivityView) => void;
};

function ActivityItems(props: ActivityBarProps & { items: ActivityItem[] }) {
  return (
    <>
      {props.items.map((item) => (
        <button
          class={`activity-icon ${props.selected === item.id ? "is-active" : ""}`}
          type="button"
          aria-label={item.label}
          aria-pressed={props.selected === item.id}
          title={item.label}
          on:click={() => props.onSelect(item.id)}
        >
          <span class={`codicon ${item.icon}`} aria-hidden="true" />
        </button>
      ))}
    </>
  );
}

export function ActivityBar(props: ActivityBarProps) {
  return (
    <nav class="activity-bar" aria-label="Activity Bar">
      <div class="activity-items">
        <ActivityItems {...props} items={activityItems} />
      </div>
      <div class="activity-items activity-items-bottom">
        <ActivityItems {...props} items={bottomActivityItems} />
      </div>
    </nav>
  );
}

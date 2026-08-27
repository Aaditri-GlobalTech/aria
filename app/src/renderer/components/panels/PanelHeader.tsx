/** Title displayed at the top of a workbench panel. */
type PanelHeaderProps = {
  title: string;
};

/** Render a panel heading. */
export function PanelHeader(props: PanelHeaderProps) {
  return (
    <div class="panel-heading">
      <h1>{props.title}</h1>
    </div>
  );
}

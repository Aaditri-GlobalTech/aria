type PanelHeaderProps = {
  title: string;
};

export function PanelHeader(props: PanelHeaderProps) {
  return (
    <div class="panel-heading">
      <h1>{props.title}</h1>
    </div>
  );
}

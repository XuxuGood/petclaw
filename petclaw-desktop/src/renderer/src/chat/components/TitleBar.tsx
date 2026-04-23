export function TitleBar() {
  return (
    <div className="drag-region h-[52px] flex items-center px-5 shrink-0">
      {/* macOS traffic lights occupy ~70px via titleBarStyle: hiddenInset */}
      <div className="w-[70px]" />
    </div>
  )
}

// Small mono "Free" tag shown in place of crown prices while crowns are switched off.
export function FreeTag({ className = '' }: { className?: string }) {
  return <span className={'tag free-tag' + (className ? ' ' + className : '')}>Free</span>;
}

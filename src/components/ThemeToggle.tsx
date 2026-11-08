import { Moon, Sun } from 'lucide-react';
import { toggleTheme, useTheme } from '../lib/theme';

// Sun / moon button that flips between the light and dark theme.
export function ThemeToggle({ className = '', label = false }: { className?: string; label?: boolean }) {
  const theme = useTheme();
  const dark = theme === 'dark';
  const text = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      className={'btn btn-sm theme-toggle' + (label ? '' : ' btn-icon') + (className ? ' ' + className : '')}
      onClick={toggleTheme}
      aria-label={text}
      title={text}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
      {label && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}

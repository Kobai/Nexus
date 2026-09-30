import { useEffect, useState } from 'react';
import mermaid from 'mermaid';
import { useThemeStore } from '../store/themeStore';

let counter = 0;

// Resolve a CSS design token ("r g b" triplet) to a concrete color for mermaid.
function token(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v.split('/')[0].trim()})` : 'currentColor';
}

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      background: token('--cafe-surface'),
      primaryColor: token('--cafe-active'),
      primaryTextColor: token('--cafe-text'),
      primaryBorderColor: token('--cafe-border'),
      lineColor: token('--cafe-muted'),
      secondaryColor: token('--cafe-hover'),
      tertiaryColor: token('--cafe-surface'),
      fontSize: '12px',
    },
  });
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const id = `mermaid-${++counter}`;
    let cancelled = false;
    setError(null);
    initMermaid();
    mermaid.render(id, chart)
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, [chart, theme]);

  if (error) {
    return <pre className="text-cafe-danger text-xs whitespace-pre-wrap">{error}</pre>;
  }

  if (!svg) {
    return <div className="skeleton h-24 rounded-lg my-4" />;
  }

  return (
    <div
      className="my-4 flex justify-center overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

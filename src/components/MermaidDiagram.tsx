import { useEffect, useState } from 'react';
import mermaid from 'mermaid';

let counter = 0;

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    background: '#F9F7F5',
    primaryColor: '#D4C9BF',
    primaryTextColor: '#3E2B1E',
    primaryBorderColor: '#B8A99A',
    lineColor: '#B8A99A',
    secondaryColor: '#EDE8E3',
    tertiaryColor: '#F9F7F5',
    fontSize: '12px',
  },
});

export function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = `mermaid-${++counter}`;
    let cancelled = false;
    mermaid.render(id, chart)
      .then((result) => {
        if (!cancelled) setSvg(result.svg);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    return <pre className="text-cafe-danger text-xs whitespace-pre-wrap">{error}</pre>;
  }

  if (!svg) {
    return <div className="text-cafe-border text-xs py-2">Rendering diagram...</div>;
  }

  return (
    <div
      className="my-4 flex justify-center overflow-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

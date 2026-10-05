import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Renderiza el mrkdwn de Slack (*negrita*) sin usar HTML crudo.
 * Devuelve elementos de React, asi no hay riesgo de inyeccion.
 */
export function Mrkdwn({ text, className }: { text: string; className?: string }) {
  return <span className={clsx('whitespace-pre-wrap', className)}>{parse(text)}</span>;
}

function parse(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Slack usa *negrita* y **negrita**. Partimos por los delimitadores conservandolos.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
  parts.forEach((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      nodes.push(<strong key={index}>{part.slice(2, -2)}</strong>);
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      nodes.push(<strong key={index}>{part.slice(1, -1)}</strong>);
    } else {
      nodes.push(<span key={index}>{part}</span>);
    }
  });
  return nodes;
}

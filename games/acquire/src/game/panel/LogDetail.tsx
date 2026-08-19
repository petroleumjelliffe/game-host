import { Cash } from '../atoms/Cash';
import { Tile } from '../atoms/Tile';
import { Brand } from '../atoms/Brand';
import { StockStack } from '../atoms/StockStack';
import { isStartupId } from '../../../engine/startups';
import type { LogToken } from '../../../engine/gameTypes';

/**
 * Renders an engine log entry's `detail` tokens with the same atoms the rest of
 * the UI uses — a tile in the log is the *same* tile vocabulary as a board cell.
 *
 * Not in the plan's task list, but the step stack takes `detail` as a
 * `ReactNode` and in the real game that node is a row of log tokens; without
 * this the catalog would have to hand-author step details, which is exactly
 * what Task 12 exists to avoid.
 */
export interface LogDetailProps {
  detail: LogToken[];
}

export function LogDetail({ detail }: LogDetailProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {detail.map((token, i) => (
        <LogTokenView key={i} token={token} />
      ))}
    </span>
  );
}

function LogTokenView({ token }: { token: LogToken }) {
  switch (token.kind) {
    case 'text':
      return <span>{token.text}</span>;
    case 'tile':
      return <Tile coord={token.coord} state="filled" />;
    case 'cash':
      return <Cash amount={token.amount} sign={token.delta ? 'delta' : undefined} />;
    case 'brand':
      return isStartupId(token.startupId) ? <Brand id={token.startupId} size="sm" /> : <span>{token.startupId}</span>;
    case 'stack':
      return isStartupId(token.startupId) ? (
        <StockStack id={token.startupId} count={token.count} size="sm" />
      ) : (
        <span>{`${token.startupId} ×${token.count}`}</span>
      );
  }
}

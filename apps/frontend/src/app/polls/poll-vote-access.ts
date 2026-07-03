import { ParamMap } from '@angular/router';

export type PublicPollAccess =
  | {
      kind: 'id';
      value: string;
    }
  | {
      kind: 'directLink';
      value: string;
    };

export function resolvePollAccess(paramMap: ParamMap): PublicPollAccess | null {
  const directLinkToken = paramMap.get('directLinkToken')?.trim();
  if (directLinkToken) {
    return {
      kind: 'directLink',
      value: directLinkToken,
    };
  }

  const id = paramMap.get('id')?.trim();
  return id
    ? {
        kind: 'id',
        value: id,
      }
    : null;
}

export function pollResultsLink(access: PublicPollAccess, pollId: string): unknown[] {
  return access.kind === 'directLink'
    ? ['/polls/direct', access.value, 'results']
    : ['/polls', pollId, 'results'];
}

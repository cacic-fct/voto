import { UnauthorizedException } from '@nestjs/common';
import { of } from 'rxjs';
import { AuthenticatedPrincipal, AuthenticatedRequest } from '../auth/auth.types';
import { AdminPollsController } from './admin-polls.controller';
import { PollsService } from './polls.service';

type PollsMock = jest.Mocked<
  Pick<
    PollsService,
    | 'listAdminPolls'
    | 'listLinkableEvents'
    | 'listEligibilityEnrollments'
    | 'addEligibilityEnrollments'
    | 'importEligibilityEnrollments'
    | 'clearEligibilityEnrollments'
    | 'deleteEligibilityEnrollment'
    | 'getAdminPollResults'
    | 'streamAdminPollResults'
    | 'getAdminPoll'
    | 'createPoll'
    | 'updatePoll'
    | 'updatePollStatus'
    | 'deletePoll'
  >
>;

function createUser(): AuthenticatedPrincipal {
  return {
    sub: 'admin-1',
    roles: [],
    permissions: [],
    scopes: [],
    oidcScopes: [],
    claims: {},
    token: 'token',
    roleSet: new Set(),
    permissionSet: new Set(),
  };
}

describe('AdminPollsController', () => {
  let polls: PollsMock;
  let controller: AdminPollsController;

  beforeEach(() => {
    polls = {
      listAdminPolls: jest.fn().mockResolvedValue(['poll-summary']),
      listLinkableEvents: jest.fn().mockResolvedValue(['event']),
      listEligibilityEnrollments: jest.fn().mockResolvedValue({ entries: [], totalCount: 0 }),
      addEligibilityEnrollments: jest.fn().mockResolvedValue({ createdCount: 1 }),
      importEligibilityEnrollments: jest.fn().mockResolvedValue({ createdCount: 1 }),
      clearEligibilityEnrollments: jest.fn().mockResolvedValue({ entries: [], totalCount: 0 }),
      deleteEligibilityEnrollment: jest.fn().mockResolvedValue(undefined),
      getAdminPollResults: jest.fn().mockResolvedValue({ pollId: 'poll-1' }),
      streamAdminPollResults: jest.fn().mockReturnValue(of({ data: { pollId: 'poll-1' } })),
      getAdminPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      createPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      updatePoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      updatePollStatus: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      deletePoll: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AdminPollsController(polls as unknown as PollsService);
  });

  it('delegates read operations to PollsService', async () => {
    await expect(controller.listPolls()).resolves.toEqual(['poll-summary']);
    await expect(controller.listLinkableEvents()).resolves.toEqual(['event']);
    await expect(controller.listEligibilityEnrollments('poll-1')).resolves.toEqual({ entries: [], totalCount: 0 });
    await expect(controller.getPollResults('poll-1')).resolves.toEqual({ pollId: 'poll-1' });
    await expect(controller.getPoll('poll-1')).resolves.toEqual({ id: 'poll-1' });

    const events = controller.streamPollResults('poll-1', '3');
    expect(polls.streamAdminPollResults).toHaveBeenCalledWith('poll-1', 3);
    await expect(new Promise((resolve) => events.subscribe(resolve))).resolves.toEqual({ data: { pollId: 'poll-1' } });

    controller.streamPollResults('poll-1', 'bad');
    expect(polls.streamAdminPollResults).toHaveBeenLastCalledWith('poll-1', 0);
  });

  it('delegates write operations with the authenticated user', async () => {
    const user = createUser();
    const request = { user } as AuthenticatedRequest;
    const savePoll = { title: 'Poll', elements: [] };

    await controller.addEligibilityEnrollments('poll-1', request, { enrollmentNumbers: ['20240001'] });
    await controller.importEligibilityEnrollments('poll-1', request, {
      format: 'txt',
      content: '20240001',
    });
    await controller.clearEligibilityEnrollments('poll-1');
    await controller.deleteEligibilityEnrollment('poll-1', '20240001');
    await controller.createPoll(request, savePoll as never);
    await controller.updatePoll('poll-1', request, savePoll as never);
    await controller.updateStatus('poll-1', request, { status: 'published' });
    await controller.deletePoll('poll-1');

    expect(polls.addEligibilityEnrollments).toHaveBeenCalledWith('poll-1', { enrollmentNumbers: ['20240001'] }, user);
    expect(polls.importEligibilityEnrollments).toHaveBeenCalledWith(
      'poll-1',
      { format: 'txt', content: '20240001' },
      user,
    );
    expect(polls.createPoll).toHaveBeenCalledWith(savePoll, user);
    expect(polls.updatePoll).toHaveBeenCalledWith('poll-1', savePoll, user);
    expect(polls.updatePollStatus).toHaveBeenCalledWith('poll-1', 'published', user);
    expect(polls.deletePoll).toHaveBeenCalledWith('poll-1');
  });

  it('rejects write operations without an authenticated user', async () => {
    expect(() =>
      controller.createPoll({} as AuthenticatedRequest, { title: 'Poll', elements: [] } as never),
    ).toThrow(UnauthorizedException);
  });
});

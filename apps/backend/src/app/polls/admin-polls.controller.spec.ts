import { UnauthorizedException } from '@nestjs/common';
import { of } from 'rxjs';
import { AuthenticatedPrincipal, AuthenticatedRequest } from '../auth/auth.types';
import { AdminPollsController } from './admin-polls.controller';
import { PollImagesService } from './poll-images.service';
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
    | 'exportCacicElectionVoterEnrollments'
    | 'streamAdminPollResults'
    | 'listAdminCacicElectionSlates'
    | 'createAdminCacicElectionSlate'
    | 'updateAdminCacicElectionSlate'
    | 'rejectCacicElectionSlate'
    | 'updateCacicElectionSlateEnabled'
    | 'deleteCacicElectionSlate'
    | 'getAdminPoll'
    | 'createPoll'
    | 'updatePoll'
    | 'updatePollStatus'
    | 'deletePoll'
  >
>;

type PollImagesMock = jest.Mocked<Pick<PollImagesService, 'deletePollImage' | 'uploadPollImage'>>;

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
  let pollImages: PollImagesMock;
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
      exportCacicElectionVoterEnrollments: jest.fn().mockResolvedValue('24123456\n25123456'),
      streamAdminPollResults: jest.fn().mockReturnValue(of({ data: { pollId: 'poll-1' } })),
      listAdminCacicElectionSlates: jest.fn().mockResolvedValue([{ id: 'slate-1' }]),
      createAdminCacicElectionSlate: jest.fn().mockResolvedValue({ id: 'slate-1' }),
      updateAdminCacicElectionSlate: jest.fn().mockResolvedValue({ id: 'slate-1' }),
      rejectCacicElectionSlate: jest.fn().mockResolvedValue({ id: 'slate-1', status: 'rejected' }),
      updateCacicElectionSlateEnabled: jest.fn().mockResolvedValue({ id: 'slate-1', enabled: false }),
      deleteCacicElectionSlate: jest.fn().mockResolvedValue(undefined),
      getAdminPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      createPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      updatePoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      updatePollStatus: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      deletePoll: jest.fn().mockResolvedValue(undefined),
    };
    pollImages = {
      deletePollImage: jest.fn().mockResolvedValue(undefined),
      uploadPollImage: jest.fn().mockResolvedValue({ id: 'image-1' }),
    };
    controller = new AdminPollsController(
      polls as unknown as PollsService,
      pollImages as unknown as PollImagesService,
    );
  });

  it('delegates read operations to PollsService', async () => {
    await expect(controller.listPolls()).resolves.toEqual(['poll-summary']);
    await expect(controller.listLinkableEvents()).resolves.toEqual(['event']);
    await expect(controller.listEligibilityEnrollments('poll-1')).resolves.toEqual({ entries: [], totalCount: 0 });
    await expect(controller.getPollResults('poll-1')).resolves.toEqual({ pollId: 'poll-1' });
    await expect(controller.listCacicElectionSlates('poll-1')).resolves.toEqual([{ id: 'slate-1' }]);
    await expect(controller.getPoll('poll-1')).resolves.toEqual({ id: 'poll-1' });

    const response = {
      attachment: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
    };
    await controller.exportCacicElectionVoterEnrollments('poll-1', response as never);
    expect(polls.exportCacicElectionVoterEnrollments).toHaveBeenCalledWith('poll-1');
    expect(response.type).toHaveBeenCalledWith('text/plain; charset=utf-8');
    expect(response.attachment).toHaveBeenCalledWith('cacic-election-poll-1-voters.txt');
    expect(response.send).toHaveBeenCalledWith('24123456\n25123456');

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
    await controller.createCacicElectionSlate('poll-1', request, { name: 'Chapa 1' } as never);
    await controller.updateCacicElectionSlate('poll-1', 'slate-1', request, { name: 'Chapa 2' } as never);
    await controller.rejectCacicElectionSlate('poll-1', 'slate-1', request, {
      reason: 'Documentos incompletos.',
    });
    await controller.updateCacicElectionSlateEnabled('poll-1', 'slate-1', { enabled: false });
    await controller.deleteCacicElectionSlate('poll-1', 'slate-1');
    await controller.clearEligibilityEnrollments('poll-1');
    await controller.deleteEligibilityEnrollment('poll-1', '20240001');
    await controller.uploadPollImage('poll-1', { originalname: 'image.png' } as never, request);
    await controller.deletePollImage('poll-1', 'image-1');
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
    expect(polls.createAdminCacicElectionSlate).toHaveBeenCalledWith('poll-1', { name: 'Chapa 1' }, user);
    expect(polls.updateAdminCacicElectionSlate).toHaveBeenCalledWith('poll-1', 'slate-1', { name: 'Chapa 2' }, user);
    expect(polls.rejectCacicElectionSlate).toHaveBeenCalledWith(
      'poll-1',
      'slate-1',
      { reason: 'Documentos incompletos.' },
      user,
    );
    expect(polls.updateCacicElectionSlateEnabled).toHaveBeenCalledWith('poll-1', 'slate-1', { enabled: false });
    expect(polls.deleteCacicElectionSlate).toHaveBeenCalledWith('poll-1', 'slate-1');
    expect(pollImages.uploadPollImage).toHaveBeenCalledWith('poll-1', { originalname: 'image.png' }, user);
    expect(pollImages.deletePollImage).toHaveBeenCalledWith('poll-1', 'image-1');
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

  it('fails image operations clearly when the image service is unavailable', async () => {
    const controllerWithoutImages = new AdminPollsController(polls as unknown as PollsService);
    const request = { user: createUser() } as AuthenticatedRequest;

    expect(() =>
      controllerWithoutImages.uploadPollImage('poll-1', { originalname: 'image.png' } as never, request),
    ).toThrow('Poll image service is not available.');
    await expect(controllerWithoutImages.deletePollImage('poll-1', 'image-1')).rejects.toThrow(
      'Poll image service is not available.',
    );
  });
});

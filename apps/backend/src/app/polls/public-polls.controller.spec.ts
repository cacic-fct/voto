import { of } from 'rxjs';
import { AuthenticatedRequest } from '../auth/auth.types';
import { PollImagesService } from './poll-images.service';
import { PublicPollsController } from './public-polls.controller';
import { PollsService } from './polls.service';

type PollsMock = jest.Mocked<
  Pick<
    PollsService,
    | 'listPublicPolls'
    | 'getPublishedPoll'
    | 'getPublishedPollByDirectLink'
    | 'assertPublishedPollReadable'
    | 'assertPublishedDirectLinkPollReadable'
    | 'getPublicPollResults'
    | 'getDirectLinkPublicPollResults'
    | 'getUserResponseState'
    | 'getDirectLinkUserResponseState'
    | 'streamPublicPollResults'
    | 'streamDirectLinkPublicPollResults'
    | 'submitResponse'
    | 'submitDirectLinkResponse'
  >
>;

type PollImagesMock = jest.Mocked<Pick<PollImagesService, 'getPollImage'>>;

describe('PublicPollsController', () => {
  let polls: PollsMock;
  let pollImages: PollImagesMock;
  let controller: PublicPollsController;

  beforeEach(() => {
    polls = {
      listPublicPolls: jest.fn().mockResolvedValue(['summary']),
      getPublishedPoll: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      getPublishedPollByDirectLink: jest.fn().mockResolvedValue({ id: 'poll-1' }),
      assertPublishedPollReadable: jest.fn().mockResolvedValue(undefined),
      assertPublishedDirectLinkPollReadable: jest.fn().mockResolvedValue('poll-1'),
      getPublicPollResults: jest.fn().mockResolvedValue({ pollId: 'poll-1' }),
      getDirectLinkPublicPollResults: jest.fn().mockResolvedValue({ pollId: 'poll-1' }),
      getUserResponseState: jest.fn().mockResolvedValue({ hasSubmitted: false }),
      getDirectLinkUserResponseState: jest.fn().mockResolvedValue({ hasSubmitted: false }),
      streamPublicPollResults: jest.fn().mockReturnValue(of({ data: { pollId: 'poll-1' } })),
      streamDirectLinkPublicPollResults: jest.fn().mockReturnValue(of({ data: { pollId: 'poll-1' } })),
      submitResponse: jest.fn().mockResolvedValue({ id: 'response-1' }),
      submitDirectLinkResponse: jest.fn().mockResolvedValue({ id: 'response-1' }),
    };
    pollImages = {
      getPollImage: jest.fn().mockResolvedValue({
        stream: { pipe: jest.fn() } as never,
        contentType: 'image/avif',
        contentLength: 5,
      }),
    };
    controller = new PublicPollsController(
      polls as unknown as PollsService,
      pollImages as unknown as PollImagesService,
    );
  });

  it('delegates public poll reads', async () => {
    const request = { user: { sub: 'user-1' } } as AuthenticatedRequest;

    await expect(controller.listPolls()).resolves.toEqual(['summary']);
    await expect(controller.getPoll('poll-1', request)).resolves.toEqual({ id: 'poll-1' });
    await expect(controller.getPollResults('poll-1', request)).resolves.toEqual({ pollId: 'poll-1' });
    expect(polls.getPublishedPoll).toHaveBeenCalledWith('poll-1', request.user);
    expect(polls.getPublicPollResults).toHaveBeenCalledWith('poll-1', request.user);
  });

  it('delegates response state, streaming, and submissions', async () => {
    const request = { user: { sub: 'user-1' } } as AuthenticatedRequest;
    const body = { answers: [] };

    await expect(controller.getMyResponse('poll-1', request)).resolves.toEqual({ hasSubmitted: false });
    await expect(controller.submitResponse('poll-1', request, body)).resolves.toEqual({ id: 'response-1' });

    const events = controller.streamPollResults('poll-1', request, '2');
    expect(polls.streamPublicPollResults).toHaveBeenCalledWith('poll-1', 2, request.user);
    await expect(new Promise((resolve) => events.subscribe(resolve))).resolves.toEqual({ data: { pollId: 'poll-1' } });

    controller.streamPollResults('poll-1', request, '-1');
    expect(polls.streamPublicPollResults).toHaveBeenLastCalledWith('poll-1', 0, request.user);
    expect(polls.getUserResponseState).toHaveBeenCalledWith('poll-1', request.user);
    expect(polls.submitResponse).toHaveBeenCalledWith('poll-1', body, request.user);
  });

  it('delegates direct-link reads, response state, streaming, and submissions', async () => {
    const request = { user: { sub: 'user-1' } } as AuthenticatedRequest;
    const token = '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad';
    const body = { answers: [] };

    await expect(controller.getPollByDirectLink(token, request)).resolves.toEqual({ id: 'poll-1' });
    await expect(controller.getDirectLinkPollResults(token, request)).resolves.toEqual({ pollId: 'poll-1' });
    await expect(controller.getMyDirectLinkResponse(token, request)).resolves.toEqual({ hasSubmitted: false });
    await expect(controller.submitDirectLinkResponse(token, request, body)).resolves.toEqual({ id: 'response-1' });

    const events = controller.streamDirectLinkPollResults(token, request, '4');
    expect(polls.streamDirectLinkPublicPollResults).toHaveBeenCalledWith(token, 4, request.user);
    await expect(new Promise((resolve) => events.subscribe(resolve))).resolves.toEqual({ data: { pollId: 'poll-1' } });

    expect(polls.getPublishedPollByDirectLink).toHaveBeenCalledWith(token, request.user);
    expect(polls.getDirectLinkPublicPollResults).toHaveBeenCalledWith(token, request.user);
    expect(polls.getDirectLinkUserResponseState).toHaveBeenCalledWith(token, request.user);
    expect(polls.submitDirectLinkResponse).toHaveBeenCalledWith(token, body, request.user);
  });

  it('checks voter access before streaming poll images', async () => {
    const request = { user: { sub: 'user-1' } } as AuthenticatedRequest;
    const response = {
      setHeader: jest.fn(),
    };

    await controller.getPollImage('poll-1', 'image-1', request, response as never);

    expect(polls.assertPublishedPollReadable).toHaveBeenCalledWith('poll-1', request.user);
    expect(pollImages.getPollImage).toHaveBeenCalledWith('poll-1', 'image-1', request.user, {
      allowPublishedRead: true,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/avif');
  });

  it('checks direct-link access before streaming direct-link poll images', async () => {
    const request = { user: { sub: 'user-1' } } as AuthenticatedRequest;
    const response = {
      setHeader: jest.fn(),
    };
    const token = '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad';

    await controller.getDirectLinkPollImage(token, 'image-1', request, response as never);

    expect(polls.assertPublishedDirectLinkPollReadable).toHaveBeenCalledWith(token, request.user);
    expect(pollImages.getPollImage).toHaveBeenCalledWith('poll-1', 'image-1', request.user, {
      allowPublishedRead: true,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/avif');
  });
});

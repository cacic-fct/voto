import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { KeycloakM2mTokenService } from '../auth/keycloak-m2m-token.service';
import { EventManagerIntegrationService } from './event-manager-integration.service';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

describe('EventManagerIntegrationService', () => {
  const originalEnv = process.env;
  let tokens: jest.Mocked<Pick<KeycloakM2mTokenService, 'getClientCredentialsToken'>>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      EVENT_MANAGER_API_URL: 'https://events.example/api/',
      EVENT_MANAGER_M2M_AUDIENCE: 'events-api',
      EVENT_MANAGER_M2M_SCOPE: 'voting',
    };
    tokens = {
      getClientCredentialsToken: jest.fn().mockResolvedValue('access-token'),
    };
    mockedAxios.get.mockReset();
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(): EventManagerIntegrationService {
    return new EventManagerIntegrationService(tokens as unknown as KeycloakM2mTokenService);
  }

  it('lists and normalizes linkable events', async () => {
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          id: ' event-1 ',
          name: ' CACiC ',
          startDate: '2026-06-21T10:00:00.000Z',
          endDate: '2026-06-21T12:00:00.000Z',
          locationDescription: ' Sala 1 ',
          shouldCollectAttendance: true,
        },
      ],
    });

    await expect(createService().listLinkableEvents()).resolves.toEqual([
      {
        id: 'event-1',
        name: 'CACiC',
        startDate: '2026-06-21T10:00:00.000Z',
        endDate: '2026-06-21T12:00:00.000Z',
        locationDescription: 'Sala 1',
        shouldCollectAttendance: true,
      },
    ]);
    expect(tokens.getClientCredentialsToken).toHaveBeenCalledWith({ audience: 'events-api', scope: 'voting' });
    expect(mockedAxios.get.mock.calls[0][0]).toMatch(/^https:\/\/events\.example\//);
    expect(mockedAxios.get.mock.calls[0][1]).toEqual({ headers: { authorization: 'Bearer access-token' } });
  });

  it('uses default Event Manager origin and omits blank event locations', async () => {
    delete process.env.EVENT_MANAGER_API_URL;
    mockedAxios.get.mockResolvedValue({
      data: [
        {
          id: 'event-1',
          name: 'CACiC',
          startDate: '2026-06-21T10:00:00.000Z',
          endDate: '2026-06-21T12:00:00.000Z',
          locationDescription: ' ',
          shouldCollectAttendance: false,
        },
      ],
    });

    await expect(createService().listLinkableEvents()).resolves.toEqual([
      {
        id: 'event-1',
        name: 'CACiC',
        startDate: '2026-06-21T10:00:00.000Z',
        endDate: '2026-06-21T12:00:00.000Z',
        locationDescription: undefined,
        shouldCollectAttendance: false,
      },
    ]);
    expect(mockedAxios.get.mock.calls[0][0]).toMatch(/^https:\/\/eventos\.cacic\.dev\.br\//);
  });

  it('rejects invalid event lists and request failures', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { not: 'array' } });
    await expect(createService().listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.get.mockResolvedValueOnce({ data: [null] });
    await expect(createService().listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.get.mockResolvedValueOnce({ data: [{ id: '', name: 'Name', startDate: 'start', endDate: 'end' }] });
    await expect(createService().listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(createService().listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);

    mockedAxios.get.mockRejectedValueOnce({});
    await expect(createService().listLinkableEvents()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('checks event attendance', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { attended: true } }).mockResolvedValueOnce({ data: { attended: false } });

    await expect(createService().hasAttendance('event-1', 'user-1')).resolves.toBe(true);
    await expect(createService().hasAttendance('event-1', 'user-2')).resolves.toBe(false);

    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ userId: 'user-1' });
    expect(mockedAxios.post.mock.calls[0][2]).toEqual({ headers: { authorization: 'Bearer access-token' } });
  });

  it('wraps attendance failures', async () => {
    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockRejectedValue(new Error('network'));

    await expect(createService().hasAttendance('event-1', 'user-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

});

import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let app: TestingModule;
  const appService = {
    getData: jest.fn(() => ({ status: 'ok', name: 'CACiC Voto API' })),
    getLiveness: jest.fn(() => ({ status: 'ok' })),
    getReadiness: jest.fn(async () => ({
      status: 'ok',
      components: { database: { status: 'ok' }, redis: { status: 'ok' } },
    })),
  };

  beforeAll(async () => {
    app = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appService }],
    }).compile();
  });

  describe('getData', () => {
    it('should return API health data', () => {
      const appController = app.get<AppController>(AppController);
      expect(appController.getData()).toEqual({
        status: 'ok',
        name: 'CACiC Voto API',
      });
    });
  });

  it('returns process liveness without checking dependencies', () => {
    const appController = app.get<AppController>(AppController);

    expect(appController.getLiveness()).toEqual({ status: 'ok' });
  });

  it('returns dependency readiness', async () => {
    const appController = app.get<AppController>(AppController);

    await expect(appController.getReadiness()).resolves.toEqual({
      status: 'ok',
      components: { database: { status: 'ok' }, redis: { status: 'ok' } },
    });
  });
});

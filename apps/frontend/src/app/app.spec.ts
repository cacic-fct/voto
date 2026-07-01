import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('dispatches an event when the cookie banner is accepted', async () => {
    const accepted = vi.fn();
    window.addEventListener('cookieBannerAccepted', accepted);
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const component = fixture.componentInstance as unknown as {
      cookieBannerConfig: {
        onAccept(): void;
      };
    };

    component.cookieBannerConfig.onAccept();

    expect(accepted).toHaveBeenCalledOnce();
    window.removeEventListener('cookieBannerAccepted', accepted);
  });
});

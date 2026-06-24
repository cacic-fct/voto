import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AuthService } from './auth.service';
import { LoginPageComponent } from './login-page.component';

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let auth: Partial<AuthService>;
  let router: Partial<Router>;

  beforeEach(async () => {
    auth = {
      isAuthenticated: vi.fn().mockReturnValue(false),
      login: vi.fn().mockResolvedValue(undefined),
    };
    router = {
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPageComponent);
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should start login when the user is unauthenticated', async () => {
    await fixture.componentInstance.login();

    expect(auth.login).toHaveBeenCalledWith({ returnTo: '/' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('should redirect authenticated users to the menu', async () => {
    vi.mocked(auth.isAuthenticated).mockReturnValue(true);

    await fixture.componentInstance.login();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(auth.login).not.toHaveBeenCalled();
  });
});

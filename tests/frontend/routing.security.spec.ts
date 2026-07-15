import '@angular/compiler';
import { EnvironmentInjector, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { authGuard } from '../../src/app/guards/auth.guard';
import { loginGuard } from '../../src/app/guards/login.guard';
import { AuthService } from '../../src/app/services/auth.service';

function createTestInjector(authValue: unknown) {
  const navigate = vi.fn();
  const injector = createEnvironmentInjector(
    [
      { provide: AuthService, useValue: { currentUser: signal(authValue) } },
      { provide: Router, useValue: { navigate } },
    ],
    null as unknown as EnvironmentInjector,
  );
  return { injector, navigate };
}

describe('Route guard integration', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('authGuard + loginGuard are mutually exclusive when not authenticated', () => {
    const { injector, navigate } = createTestInjector(null);

    const authAllowed = runInInjectionContext(injector, () => authGuard());
    const loginAllowed = runInInjectionContext(injector, () => loginGuard());

    expect(authAllowed).toBe(false);
    expect(loginAllowed).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('when authenticated, authGuard passes and loginGuard blocks', () => {
    const { injector, navigate } = createTestInjector(
      { id: 1, username: 'admin', rol: 'admin' },
    );

    const authAllowed = runInInjectionContext(injector, () => authGuard());
    const loginAllowed = runInInjectionContext(injector, () => loginGuard());

    expect(authAllowed).toBe(true);
    expect(loginAllowed).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

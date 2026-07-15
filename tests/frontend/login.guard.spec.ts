import '@angular/compiler';
import { EnvironmentInjector, createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
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

describe('loginGuard', () => {
  it('redirects to /dashboard when user is already logged in', () => {
    const { injector, navigate } = createTestInjector(
      { id: 1, username: 'admin', rol: 'admin' },
    );

    const allowed = runInInjectionContext(injector, () => loginGuard());

    expect(allowed).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('allows access to /login when no user is logged in', () => {
    const { injector, navigate } = createTestInjector(null);

    const allowed = runInInjectionContext(injector, () => loginGuard());

    expect(allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});

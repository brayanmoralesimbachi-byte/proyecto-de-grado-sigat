import '@angular/compiler';
import { createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { authGuard } from '../../src/app/guards/auth.guard';
import { AuthService } from '../../src/app/services/auth.service';

describe('authGuard security', () => {
  it('blocks anonymous access and redirects to login', () => {
    const navigate = vi.fn();

    const injector = createEnvironmentInjector([
      {
        provide: AuthService,
        useValue: { currentUser: signal(null) },
      },
      {
        provide: Router,
        useValue: { navigate },
      },
    ]);

    const allowed = runInInjectionContext(injector, () => authGuard());

    expect(allowed).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('allows access when a user is present', () => {
    const navigate = vi.fn();

    const injector = createEnvironmentInjector([
      {
        provide: AuthService,
        useValue: { currentUser: signal({ id: 1, username: 'admin', rol: 'admin' }) },
      },
      {
        provide: Router,
        useValue: { navigate },
      },
    ]);

    const allowed = runInInjectionContext(injector, () => authGuard());

    expect(allowed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});
import '@angular/compiler';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';
import { ActivosComponent } from '../../src/app/components/activos/activos.component';
import { FormatMarkdownPipe } from '../../src/app/pipes/format-markdown.pipe';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';

// ============================================================
// Pruebas de Seguridad: Rate Limiting en Login
// ============================================================
describe('Rate limiting - login attempts (frontend behavior)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not store credentials in sessionStorage after failed login', async () => {
    const tauri = { login: vi.fn(), logout: vi.fn() } as unknown as TauriService;
    vi.mocked(tauri.login).mockResolvedValue({
      success: false, message: 'Credenciales inválidas', user_id: null, username: null, rol: null, timezone: null,
    });

    const service = new AuthService(tauri);
    await service.login('user', 'wrong');

    expect(sessionStorage.getItem('currentUser')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('does store user data after successful login', async () => {
    const tauri = { login: vi.fn(), logout: vi.fn() } as unknown as TauriService;
    vi.mocked(tauri.login).mockResolvedValue({
      success: true, message: 'ok', user_id: 1, username: 'testuser', rol: 'admin', timezone: 'America/Bogota',
    });

    const service = new AuthService(tauri);
    await service.login('testuser', 'correct');

    const stored = JSON.parse(sessionStorage.getItem('currentUser')!);
    expect(stored.username).toBe('testuser');
    expect(stored.password).toBeUndefined();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('handles rapid sequential login attempts without crash', async () => {
    const tauri = { login: vi.fn(), logout: vi.fn() } as unknown as TauriService;
    vi.mocked(tauri.login).mockResolvedValue({
      success: false, message: 'Credenciales inválidas', user_id: null, username: null, rol: null, timezone: null,
    });

    const service = new AuthService(tauri);
    for (let i = 0; i < 20; i++) {
      await service.login('target', `pass${i}`);
    }

    expect(service.isAuthenticated()).toBe(false);
    expect(tauri.login).toHaveBeenCalledTimes(20);
  });
});

// ============================================================
// Pruebas de Seguridad: Timeout de Sesión por Inactividad
// ============================================================
describe('Session inactivity timeout', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs out after inactivity timeout (15 min)', async () => {
    const tauri = { login: vi.fn(), logout: vi.fn() } as unknown as TauriService;
    vi.mocked(tauri.login).mockResolvedValue({
      success: true, message: 'ok', user_id: 1, username: 'user', rol: 'operador', timezone: 'America/Bogota',
    });
    vi.mocked(tauri.logout).mockResolvedValue('ok');

    const service = new AuthService(tauri);
    await service.login('user', 'pass');
    expect(service.isAuthenticated()).toBe(true);

    // Simular inactividad (avanzar 16 minutos) usando async para flush de microtasks
    await vi.advanceTimersByTimeAsync(16 * 60 * 1000 + 1000);

    expect(service.isAuthenticated()).toBe(false);
    expect(tauri.logout).toHaveBeenCalledTimes(1);
  });

  it('does NOT logout if activity occurs within timeout', async () => {
    const tauri = { login: vi.fn(), logout: vi.fn() } as unknown as TauriService;
    vi.mocked(tauri.login).mockResolvedValue({
      success: true, message: 'ok', user_id: 1, username: 'user', rol: 'operador', timezone: 'America/Bogota',
    });
    vi.mocked(tauri.logout).mockResolvedValue('ok');

    const service = new AuthService(tauri);
    await service.login('user', 'pass');
    expect(service.isAuthenticated()).toBe(true);

    // Simular actividad cada 10 minutos (dentro del límite de 15)
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(10 * 60 * 1000);
      window.dispatchEvent(new MouseEvent('mousemove'));
      // Forzar check del timer
      vi.advanceTimersByTime(60 * 1000);
    }

    expect(service.isAuthenticated()).toBe(true);
    expect(tauri.logout).not.toHaveBeenCalled();
  });

  it('cleans up interval on logout', async () => {
    const tauri = { login: vi.fn(), logout: vi.fn() } as unknown as TauriService;
    vi.mocked(tauri.login).mockResolvedValue({
      success: true, message: 'ok', user_id: 1, username: 'user', rol: 'operador', timezone: 'America/Bogota',
    });
    vi.mocked(tauri.logout).mockResolvedValue('ok');

    const service = new AuthService(tauri);
    await service.login('user', 'pass');
    await service.logout();

    // Después de logout, avanzar 30 min y verificar que no llame a logout otra vez
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(tauri.logout).toHaveBeenCalledTimes(1); // solo la llamada manual
  });
});

// ============================================================
// Pruebas: Formateo Markdown Seguro
// ============================================================
describe('FormatMarkdownPipe - XSS prevention', () => {
  const sanitizer = {
    bypassSecurityTrustHtml: vi.fn((html: string) => html),
  } as unknown as DomSanitizer;

  it('escapes script tags preventing XSS execution', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('<script>alert("xss")</script>');
    // Los tags HTML se escapan a entidades, no se renderizan como HTML
    expect(result).not.toContain('<script>');
    // El contenido se muestra como texto seguro
    expect(result).toContain('&lt;script&gt;');
  });

  it('strips iframe tags', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('<iframe src="http://evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
  });

  it('strips event handler attributes', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('onerror');
  });

  it('strips javascript: URLs from links', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('still renders safe markdown correctly', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('**bold** and *italic*');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('escapes HTML entities before markdown conversion', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('<b>not bold</b>');
    expect(result).not.toContain('<b>');
    expect(result).toContain('&lt;b&gt;');
  });

  it('handles empty input gracefully', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform(null as unknown as string)).toBe('');
  });

  it('handles code blocks without breaking', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result = pipe.transform('use `console.log()`');
    expect(result).toContain('<code>');
    expect(result).toContain('console.log()');
  });

  it('strips object and embed tags', () => {
    const pipe = new FormatMarkdownPipe(sanitizer);
    const result1 = pipe.transform('<object data="evil.swf"></object>');
    const result2 = pipe.transform('<embed src="evil.swf">');
    expect(result1).not.toContain('<object');
    expect(result2).not.toContain('<embed');
  });
});

// ============================================================
// Pruebas: parseImagenes - compatibilidad hacia atrás
// ============================================================
describe('parseImagenes - multi-image support', () => {
  it('returns empty array for undefined imagen_base64', () => {
    const tauri = {} as unknown as TauriService;
    const auth = { currentUser: vi.fn() } as unknown as AuthService;
    const router = { navigate: vi.fn() } as unknown as Router;
    const component = new ActivosComponent(tauri, auth, router);

    const result = component.parseImagenes({ codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O' });
    expect(result).toEqual([]);
  });

  it('parses JSON array from imagen_base64', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    const result = component.parseImagenes({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: JSON.stringify(['img1', 'img2', 'img3']),
    });
    expect(result).toEqual(['img1', 'img2', 'img3']);
  });

  it('handles single base64 string (backward compat)', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    const result = component.parseImagenes({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: 'data:image/png;base64,single',
    });
    expect(result).toEqual(['data:image/png;base64,single']);
  });

  it('handles malformed JSON gracefully', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    const result = component.parseImagenes({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: '{not valid json}',
    });
    // Should treat as single image
    expect(result).toEqual(['{not valid json}']);
  });
});

// ============================================================
// Pruebas: Carrusel de imágenes
// ============================================================
describe('Image carousel navigation', () => {
  it('navigates forward and wraps around', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    // Simular 3 imágenes en detalles
    component.selectedActivoDetalle.set({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: JSON.stringify(['a', 'b', 'c']),
    });
    component.carouselCurrentIndex.set(0);

    component.nextImage();
    expect(component.carouselCurrentIndex()).toBe(1);

    component.nextImage();
    expect(component.carouselCurrentIndex()).toBe(2);

    // Wrap around
    component.nextImage();
    expect(component.carouselCurrentIndex()).toBe(0);
  });

  it('navigates backward and wraps around', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    component.selectedActivoDetalle.set({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: JSON.stringify(['a', 'b', 'c']),
    });
    component.carouselCurrentIndex.set(0);

    component.prevImage();
    expect(component.carouselCurrentIndex()).toBe(2); // wrap to last

    component.prevImage();
    expect(component.carouselCurrentIndex()).toBe(1);
  });

  it('does nothing with single image', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    component.selectedActivoDetalle.set({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: JSON.stringify(['single']),
    });
    component.carouselCurrentIndex.set(0);

    component.nextImage();
    expect(component.carouselCurrentIndex()).toBe(0);

    component.prevImage();
    expect(component.carouselCurrentIndex()).toBe(0);
  });

  it('returns empty array from getCurrentImages when no detalles', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    component.selectedActivoDetalle.set(null);
    expect(component.getCurrentImages()).toEqual([]);
  });

  it('goToImage jumps to specific index', () => {
    const component = new ActivosComponent({} as unknown as TauriService, { currentUser: vi.fn() } as unknown as AuthService, { navigate: vi.fn() } as unknown as Router);

    component.selectedActivoDetalle.set({
      codigo: 'T', nombre: 'T', categoria: 'C', estado: 'O',
      imagen_base64: JSON.stringify(['a', 'b', 'c']),
    });

    component.goToImage(2);
    expect(component.carouselCurrentIndex()).toBe(2);
  });
});

// ============================================================
// Pruebas: Serialización de imágenes en saveActivo
// ============================================================
describe('saveActivo image serialization', () => {
  it('sets imagen_base64 to undefined when no images', async () => {
    const tauri = {
      getCategorias: vi.fn(),
      getActivos: vi.fn().mockResolvedValue([]),
      createActivo: vi.fn().mockResolvedValue(1),
    } as unknown as TauriService;
    const auth = {
      currentUser: vi.fn(() => ({ id: 1, username: 'admin', rol: 'admin' })),
    } as unknown as AuthService;
    const router = { navigate: vi.fn() } as unknown as Router;
    const component = new ActivosComponent(tauri, auth, router);

    component.imagenes.set([]);
    component.currentActivo.set({
      codigo: 'TEST-002',
      nombre: 'No images',
      categoria: 'Equipos de Cómputo',
      estado: 'operativo',
      base_datos_id: 1,
    });

    const createSpy = vi.mocked(tauri.createActivo);
    await component.saveActivo();

    const sent = createSpy.mock.calls[0][0];
    expect(sent.imagen_base64).toBeUndefined();
  });

  it('removes all images and saves correctly', () => {
    const tauri = {} as unknown as TauriService;
    const auth = { currentUser: vi.fn() } as unknown as AuthService;
    const router = { navigate: vi.fn() } as unknown as Router;
    const component = new ActivosComponent(tauri, auth, router);

    component.imagenes.set(['img1', 'img2']);
    component.removeImageAtIndex(0);
    component.removeImageAtIndex(0);
    expect(component.imagenes().length).toBe(0);
  });
});

// ============================================================
// Pruebas: CSP está configurado en tauri.conf.json
// ============================================================
describe('CSP configuration', () => {
  it('CSP is not null in tauri.conf.json', () => {
    const config = require('../../src-tauri/tauri.conf.json');
    expect(config.app.security.csp).not.toBeNull();
    expect(config.app.security.csp).toContain("default-src 'self'");
    expect(config.app.security.csp).toContain("img-src 'self' data: blob: asset:");
  });
});

import '@angular/compiler';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ActivosComponent } from '../../src/app/components/activos/activos.component';
import { AuthService } from '../../src/app/services/auth.service';
import { TauriService } from '../../src/app/services/tauri.service';
import { Router } from '@angular/router';

const createComponent = () => {
  const tauri = {
    getCategorias: vi.fn(),
    getActivos: vi.fn(),
  } as unknown as TauriService;

  const auth = {
    currentUser: vi.fn(() => ({ id: 1, username: 'admin', rol: 'admin' })),
    hasRole: vi.fn(() => true),
  } as unknown as AuthService;

  const router = { navigate: vi.fn() } as unknown as Router;

  return new ActivosComponent(tauri, auth, router);
};

describe('Activos upload security', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects files larger than 5MB', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const component = createComponent();

    const file = { size: 6 * 1024 * 1024, type: 'image/png' } as File;
    const event = { target: { files: [file] } } as unknown as Event;

    component.onImageSelect(event);

    expect(alertSpy).toHaveBeenCalledWith('La imagen no debe superar los 5MB');
    expect(component.currentActivo().imagen_base64).toBeUndefined();
  });

  it('rejects non-image files', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const component = createComponent();

    const file = { size: 1000, type: 'application/pdf' } as File;
    const event = { target: { files: [file] } } as unknown as Event;

    component.onImageSelect(event);

    expect(alertSpy).toHaveBeenCalledWith('Solo se permiten archivos de imagen');
    expect(component.currentActivo().imagen_base64).toBeUndefined();
  });

  it('converts valid image to base64 for secure transport', () => {
    const component = createComponent();
    const expectedBase64 = 'data:image/png;base64,ZmFrZS1kYXRh';

    class FileReaderMock {
      result: string | ArrayBuffer | null = expectedBase64;
      onload: null | (() => void) = null;

      readAsDataURL(_file: File): void {
        if (this.onload) {
          this.onload();
        }
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock as unknown as typeof FileReader);

    const file = { size: 1000, type: 'image/png' } as File;
    const event = { target: { files: [file] } } as unknown as Event;

    component.onImageSelect(event);

    expect(component.currentActivo().imagen_base64).toBe(expectedBase64);
  });
});
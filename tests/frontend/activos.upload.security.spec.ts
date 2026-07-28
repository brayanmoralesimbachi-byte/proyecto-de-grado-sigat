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

  it('rejects files larger than 40MB', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const component = createComponent();

    const blob = new Blob(['x'.repeat(41 * 1024 * 1024)], { type: 'image/png' });
    const file = new File([blob], 'large.png', { type: 'image/png' });
    const event = { target: { files: [file] } } as unknown as Event;

    component.onImagesSelect(event);

    expect(alertSpy).toHaveBeenCalled();
    expect(component.imagenes().length).toBe(0);
  });

  it('rejects non-image files', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const component = createComponent();

    const blob = new Blob(['fake-pdf-content'], { type: 'application/pdf' });
    const file = new File([blob], 'doc.pdf', { type: 'application/pdf' });
    const event = { target: { files: [file] } } as unknown as Event;

    component.onImagesSelect(event);

    expect(alertSpy).toHaveBeenCalled();
    expect(component.imagenes().length).toBe(0);
  });

  it('converts valid image to base64 for secure transport', () => {
    const component = createComponent();
    const expectedBase64 = 'data:image/png;base64,ZmFrZS1kYXRh';

    class FileReaderMock {
      result: string | ArrayBuffer | null = expectedBase64;
      onload: null | (() => void) = null;

      readAsDataURL(_file: Blob): void {
        if (this.onload) {
          this.onload();
        }
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock as unknown as typeof FileReader);

    const blob = new Blob(['fake-image'], { type: 'image/png' });
    const file = new File([blob], 'img.png', { type: 'image/png' });
    const event = { target: { files: [file] } } as unknown as Event;

    component.onImagesSelect(event);

    expect(component.imagenes().length).toBe(1);
    expect(component.imagenes()[0]).toBe(expectedBase64);
  });

  it('enforces maximum of 15 images', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const component = createComponent();

    class FileReaderMock {
      result = 'data:image/png;base64,dGVzdA==';
      onload: null | (() => void) = null;

      readAsDataURL(_file: Blob): void {
        if (this.onload) {
          this.onload();
        }
      }
    }

    vi.stubGlobal('FileReader', FileReaderMock as unknown as typeof FileReader);

    const blob = new Blob(['fake-image'], { type: 'image/png' });
    const file = new File([blob], 'img.png', { type: 'image/png' });

    for (let i = 0; i < 15; i++) {
      const event = { target: { files: [file] } } as unknown as Event;
      component.onImagesSelect(event);
    }
    expect(component.imagenes().length).toBe(15);

    const event = { target: { files: [file] } } as unknown as Event;
    component.onImagesSelect(event);
    expect(component.imagenes().length).toBe(15);
    expect(alertSpy).toHaveBeenCalledWith('Máximo 15 imágenes por activo');
  });

  it('can remove image by index', () => {
    const component = createComponent();

    class FileReaderMock {
      result = 'data:image/png;base64,dGVzdA==';
      onload: null | (() => void) = null;

      readAsDataURL(_file: Blob): void {
        if (this.onload) {
          this.onload();
        }
      }
    }
    vi.stubGlobal('FileReader', FileReaderMock as unknown as typeof FileReader);

    const blob = new Blob(['fake-image'], { type: 'image/png' });
    const file = new File([blob], 'img.png', { type: 'image/png' });

    const event1 = { target: { files: [file] } } as unknown as Event;
    const event2 = { target: { files: [file] } } as unknown as Event;

    component.onImagesSelect(event1);
    component.onImagesSelect(event2);
    expect(component.imagenes().length).toBe(2);

    component.removeImageAtIndex(0);
    expect(component.imagenes().length).toBe(1);
  });

  it('serializes multiple images as JSON in saveActivo', async () => {
    const component = createComponent();
    component.imagenes.set(['img1', 'img2', 'img3']);
    component.currentActivo.set({
      codigo: 'TEST-001',
      nombre: 'Test',
      categoria: 'Equipos de Cómputo',
      estado: 'operativo',
      base_datos_id: 1,
    });

    const createActivoSpy = vi.fn().mockResolvedValue(1);
    const tauri = {
      getCategorias: vi.fn(),
      getActivos: vi.fn().mockResolvedValue([]),
      createActivo: createActivoSpy,
      updateActivo: vi.fn(),
    } as unknown as TauriService;
    component['tauriService'] = tauri;

    component['authService'] = {
      currentUser: vi.fn(() => ({ id: 1, username: 'admin', rol: 'admin' })),
    } as unknown as AuthService;

    await component.saveActivo();

    expect(createActivoSpy).toHaveBeenCalled();
    const sentActivo = createActivoSpy.mock.calls[0][0];
    expect(sentActivo.imagen_base64).toBe(JSON.stringify(['img1', 'img2', 'img3']));
  });
});

import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './services/auth.service';
import { TauriService } from './services/tauri.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('gestor-activos');
  private tauriService = inject(TauriService);
  private authService = inject(AuthService);
  private router = inject(Router);

  ngOnInit(): void {
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    window.addEventListener('popstate', this.handlePopState.bind(this));
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    window.removeEventListener('popstate', this.handlePopState.bind(this));
  }

  /** Bloquea los botones atrás/adelante del mouse cuando hay sesión activa */
  private handlePopState(event: PopStateEvent): void {
    if (!this.authService.currentUser()) return;

    event.preventDefault();
    // Re-push la ruta actual para anular el popstate
    const currentUrl = this.router.url;
    window.history.pushState(null, '', currentUrl);
  }

  private handleBeforeUnload(event: BeforeUnloadEvent): void {
    // Si hay sesión activa, prevenir cierre y forzar logout
    if (this.authService.isAuthenticated()) {
      event.preventDefault();
      
      // Intentar forzar logout
      this.tauriService.forceLogout().then(() => {
        console.log('Logout forzoso completado');
      }).catch(error => {
        console.error('Error al realizar logout forzoso:', error);
      });
      
      // Mostrar mensaje de advertencia
      event.returnValue = 'Debe cerrar sesión antes de cerrar la aplicación';
    }
  }
}

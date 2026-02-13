import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Activo, TauriService } from '../../services/tauri.service';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  activos = signal<Activo[]>([]);
  isLoading = signal(true);
  errorMessage = signal('');

  constructor(
    public authService: AuthService,
    private tauriService: TauriService,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    await this.loadActivos();
  }

  async loadActivos(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');

    try {
      const activos = await this.tauriService.getActivos();
      this.activos.set(activos);
    } catch (error) {
      this.errorMessage.set('Error al cargar activos: ' + error);
    } finally {
      this.isLoading.set(false);
    }
  }

  navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/']);
  }
}

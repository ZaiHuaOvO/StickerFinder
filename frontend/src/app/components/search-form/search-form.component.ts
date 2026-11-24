import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { finalize } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api.service';
import { PLATFORM_META } from '../../core/labels';
import {
  Platform,
  PLATFORM_ORDER,
  ProvidersStatusResponse,
  SearchFormPayload,
  UploadedImage,
} from '../../core/models';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

@Component({
  selector: 'app-search-form',
  imports: [
    ReactiveFormsModule,
    NzFormModule,
    NzInputModule,
    NzButtonModule,
    NzCheckboxModule,
    NzIconModule,
    NzTagModule,
    NzAlertModule,
  ],
  templateUrl: './search-form.component.html',
  styleUrl: './search-form.component.less',
})
export class SearchFormComponent implements OnDestroy {
  @Input() busy = false;
  readonly statuses = input<ProvidersStatusResponse | null>(null);
  @Output() readonly search = new EventEmitter<SearchFormPayload>();

  private readonly api = inject(ApiService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private objectUrl: string | null = null;

  readonly formError = signal<string | null>(null);
  readonly platforms = PLATFORM_ORDER;
  readonly form = this.formBuilder.group({
    targetName: ['', [Validators.required, Validators.maxLength(200)]],
    seriesName: ['', [Validators.maxLength(200)]],
    aliases: [''],
    seriesAliases: [''],
    brandNames: [''],
  });

  readonly uploading = signal(false);
  readonly dragActive = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly image = signal<{ info: UploadedImage; name: string } | null>(null);
  readonly previewUrl = signal<string | null>(null);

  private readonly selectionTouched = signal(false);
  private readonly manualSelection = signal<Platform[]>([]);

  readonly configuredPlatforms = computed<Platform[]>(() =>
    PLATFORM_ORDER.filter((platform) => this.statuses()?.platforms?.[platform]?.configured),
  );
  readonly selectedPlatforms = computed<Platform[]>(() =>
    this.selectionTouched() ? this.manualSelection() : this.configuredPlatforms(),
  );

  platformLabel(platform: Platform): string {
    return PLATFORM_META[platform].label;
  }

  isConfigured(platform: Platform): boolean {
    return this.statuses()?.platforms?.[platform]?.configured ?? false;
  }

  platformReason(platform: Platform): string {
    const status = this.statuses()?.platforms?.[platform];
    return status?.configured ? '' : (status?.reason ?? '未配置');
  }

  isSelected(platform: Platform): boolean {
    return this.selectedPlatforms().includes(platform);
  }

  togglePlatform(platform: Platform, checked: boolean): void {
    if (!this.isConfigured(platform)) return;
    const current = this.selectedPlatforms();
    const next = checked
      ? [...current, platform]
      : current.filter((item) => item !== platform);
    this.selectionTouched.set(true);
    this.manualSelection.set(next);
    this.formError.set(null);
  }

  readonly allSelected = computed(() => {
    const configured = this.configuredPlatforms();
    return configured.length > 0 && this.selectedPlatforms().length === configured.length;
  });

  readonly selectionIndeterminate = computed(() => {
    const selected = this.selectedPlatforms().length;
    return selected > 0 && selected < this.configuredPlatforms().length;
  });

  toggleAll(checked: boolean): void {
    this.selectionTouched.set(true);
    this.manualSelection.set(checked ? [...this.configuredPlatforms()] : []);
    this.formError.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.uploadFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.busy) this.dragActive.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadFile(file);
  }

  @HostListener('window:paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    if (this.busy || this.uploading()) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && IMAGE_TYPES.includes(item.type)) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          this.uploadFile(file);
        }
        return;
      }
    }
  }

  private uploadFile(file: File): void {
    if (this.busy) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      this.uploadError.set('仅支持 PNG / JPEG / WEBP / GIF 图片');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.uploadError.set('图片不能超过 5MB');
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);
    this.api
      .uploadReferenceImage(file)
      .pipe(finalize(() => this.uploading.set(false)))
      .subscribe({
        next: (info) => {
          this.revokePreview();
          this.image.set({ info, name: file.name || '粘贴的图片' });
          this.previewUrl.set(URL.createObjectURL(file));
          this.objectUrl = this.previewUrl();
        },
        error: (error: unknown) => {
          this.uploadError.set(apiErrorMessage(error));
        },
      });
  }

  removeImage(): void {
    this.revokePreview();
    this.image.set(null);
    this.previewUrl.set(null);
    this.uploadError.set(null);
  }

  submit(): void {
    if (this.busy || this.uploading()) return;
    this.formError.set(null);
    if (this.form.invalid) {
      Object.values(this.form.controls).forEach((control) => {
        control.markAsDirty();
        control.updateValueAndValidity();
      });
      return;
    }

    const raw = this.form.getRawValue();
    const targetName = raw.targetName.trim();
    if (!targetName) {
      this.formError.set('请输入名称');
      return;
    }

    const platforms = this.selectedPlatforms();
    if (platforms.length === 0) {
      this.formError.set('至少选择一个平台');
      return;
    }

    const aliases = this.parseList(raw.aliases);
    const seriesAliases = this.parseList(raw.seriesAliases);
    const brandNames = this.parseList(raw.brandNames);

    for (const [label, list] of [
      ['别名', aliases],
      ['系列别名', seriesAliases],
      ['品牌/创作者', brandNames],
    ] as const) {
      if (list.length > 20) {
        this.formError.set(`${label}最多 20 个`);
        return;
      }
      if (list.some((item) => item.length > 100)) {
        this.formError.set(`${label}单项不能超过 100 个字符`);
        return;
      }
    }

    this.search.emit({
      targetName,
      seriesName: raw.seriesName.trim() || undefined,
      aliases,
      seriesAliases,
      brandNames,
      referenceImageId: this.image()?.info.referenceImageId ?? null,
      platforms,
    });
  }

  private parseList(value: string): string[] {
    return value
      .split(/[,，、;\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, list) => list.indexOf(item) === index);
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }

  private revokePreview(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}

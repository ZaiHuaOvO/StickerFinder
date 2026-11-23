import {
  Component,
  EventEmitter,
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
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { finalize } from 'rxjs';
import { ApiService, apiErrorMessage } from '../../core/api.service';
import { SearchFormPayload, UploadedImage } from '../../core/models';

@Component({
  selector: 'app-search-form',
  imports: [
    ReactiveFormsModule,
    NzFormModule,
    NzInputModule,
    NzButtonModule,
    NzIconModule,
    NzTagModule,
    NzAlertModule,
  ],
  templateUrl: './search-form.component.html',
  styleUrl: './search-form.component.less',
})
export class SearchFormComponent implements OnDestroy {
  @Input() busy = false;
  @Output() readonly search = new EventEmitter<SearchFormPayload>();
  readonly visionEnabled = input(false);

  private readonly api = inject(ApiService);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private objectUrl: string | null = null;

  readonly formError = signal<string | null>(null);
  readonly imageHint = computed(() =>
    this.visionEnabled()
      ? '可选：上传后由 AI 视觉能力辅助比对，视觉结果只作为辅助证据。'
      : '可选：参考图会保存在搜索记录中；当前未启用 AI 视觉比对，不影响文字识别。',
  );

  readonly form = this.formBuilder.group({
    targetName: ['', [Validators.required, Validators.maxLength(200)]],
    seriesName: ['', [Validators.maxLength(200)]],
    aliases: [''],
  });

  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly image = signal<{ info: UploadedImage; name: string } | null>(null);
  readonly previewUrl = signal<string | null>(null);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      this.uploadError.set('仅支持 PNG / JPEG / WEBP / GIF 图片');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.uploadError.set('图片大小不能超过 5MB');
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
          this.image.set({ info, name: file.name });
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
      this.formError.set('请输入目标贴纸名称');
      return;
    }

    const aliases = raw.aliases
      .split(/[,，、;\n]/)
      .map((alias) => alias.trim())
      .filter(Boolean)
      .filter((alias, index, list) => list.indexOf(alias) === index);

    if (aliases.length > 20) {
      this.formError.set('别名最多 20 个');
      return;
    }
    if (aliases.some((alias) => alias.length > 100)) {
      this.formError.set('单个别名不能超过 100 个字符');
      return;
    }

    this.search.emit({
      targetName,
      seriesName: raw.seriesName.trim() || undefined,
      aliases,
      referenceImageId: this.image()?.info.referenceImageId ?? null,
    });
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

import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { NZ_MODAL_DATA } from 'ng-zorro-antd/modal';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { Product } from '../../core/models';

export interface ReviewModalData {
  product: Product;
}

export interface ReviewModalResult {
  decision: 'MATCH' | 'NO_MATCH' | 'PENDING';
  note: string;
}

@Component({
  selector: 'app-review-modal',
  imports: [ReactiveFormsModule, NzFormModule, NzInputModule, NzRadioModule],
  template: `
    <div class="review-summary">
      <strong>{{ data.product.title }}</strong>
      <p>{{ data.product.match?.summary || '暂无 AI 内容摘要' }}</p>
    </div>
    <form nz-form nzLayout="vertical" [formGroup]="form">
      <nz-form-item>
        <nz-form-label>人工判断</nz-form-label>
        <nz-form-control>
          <nz-radio-group formControlName="decision">
            <label nz-radio nzValue="MATCH">确认包含目标贴纸</label>
            <label nz-radio nzValue="NO_MATCH">确认不包含</label>
            <label nz-radio nzValue="PENDING">暂不判断</label>
          </nz-radio-group>
        </nz-form-control>
      </nz-form-item>
      <nz-form-item>
        <nz-form-label>核对备注（可选）</nz-form-label>
        <nz-form-control>
          <textarea
            nz-input
            formControlName="note"
            rows="3"
            maxlength="2000"
            placeholder="例如：已打开商品页核对 SKU 与价格，确认包含 B 贴纸"
          ></textarea>
        </nz-form-control>
      </nz-form-item>
    </form>
    <p class="review-hint">人工结果会单独保存，不会覆盖 AI 的原始判断。</p>
  `,
  styles: [
    `
      .review-summary {
        padding: 12px 14px;
        margin-bottom: 16px;
        background: var(--surface-soft);
        border-radius: 10px;
      }
      .review-summary p {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .review-hint {
        margin: 0;
        color: var(--muted);
        font-size: 12px;
      }
      nz-radio-group {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 18px;
      }
    `,
  ],
})
export class ReviewModalComponent {
  readonly data = inject<ReviewModalData>(NZ_MODAL_DATA);
  private readonly formBuilder = inject(FormBuilder);

  readonly form = this.formBuilder.nonNullable.group({
    decision: [this.data.product.match?.manualDecision ?? 'PENDING', Validators.required],
    note: [this.data.product.match?.manualNote ?? ''],
  });
}

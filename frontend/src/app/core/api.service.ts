import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CreateSearchPayload,
  Product,
  ProvidersStatusResponse,
  ReviewPayload,
  SearchDetail,
  SearchRunSummary,
  UploadedImage,
  VerificationBrowserInfo,
  VerificationResumeInfo,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  getProviderStatuses(): Observable<ProvidersStatusResponse> {
    return this.http.get<ProvidersStatusResponse>(`${this.base}/providers/status`);
  }

  createSearch(payload: CreateSearchPayload): Observable<{ searchId: string; status: string }> {
    return this.http.post<{ searchId: string; status: string }>(
      `${this.base}/searches`,
      payload,
    );
  }

  getSearch(searchId: string): Observable<SearchDetail> {
    return this.http.get<SearchDetail>(`${this.base}/searches/${searchId}`);
  }

  cancelSearch(
    searchId: string,
  ): Observable<{ searchId: string; status: string }> {
    return this.http.post<{ searchId: string; status: string }>(
      `${this.base}/searches/${searchId}/cancel`,
      {},
    );
  }

  listSearches(limit = 10): Observable<SearchRunSummary[]> {
    return this.http.get<SearchRunSummary[]>(`${this.base}/searches?limit=${limit}`);
  }

  reviewCandidate(candidateId: string, payload: ReviewPayload): Observable<Product> {
    return this.http.patch<Product>(`${this.base}/candidates/${candidateId}/review`, payload);
  }

  uploadReferenceImage(file: File): Observable<UploadedImage> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<UploadedImage>(`${this.base}/uploads/reference-image`, form);
  }

  openVerificationBrowser(
    searchId: string,
    taskId: string,
  ): Observable<VerificationBrowserInfo> {
    return this.http.post<VerificationBrowserInfo>(
      `${this.base}/searches/${searchId}/tasks/${taskId}/verification/browser`,
      {},
    );
  }

  closeVerificationBrowser(
    searchId: string,
    taskId: string,
  ): Observable<{ closed: boolean }> {
    return this.http.delete<{ closed: boolean }>(
      `${this.base}/searches/${searchId}/tasks/${taskId}/verification/browser`,
    );
  }

  resumeVerification(
    searchId: string,
    taskId: string,
  ): Observable<VerificationResumeInfo> {
    return this.http.post<VerificationResumeInfo>(
      `${this.base}/searches/${searchId}/tasks/${taskId}/verification/resume`,
      {},
    );
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string | string[] } | null;
    if (body?.message) {
      return Array.isArray(body.message) ? body.message.join('；') : body.message;
    }
    if (error.status === 0) {
      return '无法连接后端服务，请确认后端已在 http://localhost:3000 启动';
    }
    return `请求失败（HTTP ${error.status}）`;
  }
  return error instanceof Error ? error.message : String(error);
}

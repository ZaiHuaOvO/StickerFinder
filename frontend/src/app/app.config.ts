import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { IconDefinition } from '@ant-design/icons-angular';
import * as AllIcons from '@ant-design/icons-angular/icons';
import { provideNzI18n, zh_CN } from 'ng-zorro-antd/i18n';
import { provideNzIcons } from 'ng-zorro-antd/icon';

const antIcons = (Object.values(AllIcons) as unknown[]).filter(
  (icon): icon is IconDefinition =>
    typeof icon === 'object' && icon !== null && 'icon' in (icon as Record<string, unknown>),
);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideNzI18n(zh_CN),
    provideNzIcons(antIcons),
  ],
};

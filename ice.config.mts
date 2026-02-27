import { defineConfig } from '@ice/app';
import miniapp from '@ice/plugin-miniapp';

// The project config, see https://v3.ice.work/docs/guide/basic/config
export default defineConfig(() => ({
  plugins: [
    miniapp({
      templateRegistration: {
        excludeComponents: [
          'open-data',
          'official-account',
          'ad',
          'ad-custom',
          'live-player',
          'live-pusher',
        ],
        componentProps: {
          button: {
            exclude: [
              'bindGetUserInfo',
              'bindGetPhoneNumber',
              'bindGetRealTimePhoneNumber',
              'bindAgreePrivacyAuthorization',
              'bindContact',
              'bindOpenSetting',
              'bindLaunchApp',
              'app-parameter',
            ],
          },
        },
      },
    }),
  ],
}));

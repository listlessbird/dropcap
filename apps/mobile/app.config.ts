import type { ExpoConfig } from "expo/config";

const APP_VARIANTS = ["development", "preview", "production"] as const;

type AppVariant = (typeof APP_VARIANTS)[number];

interface VariantConfig {
  readonly appName: string;
  readonly scheme: string;
  readonly androidPackage: string;
  readonly icon: string;
  readonly adaptiveBackground: string;
}

const VARIANT_CONFIG = {
  development: {
    appName: "Kindle Drop Dev",
    scheme: "kindledrop-dev",
    androidPackage: "com.listlessbird.kindledrop.dev",
    icon: "./assets/icon-development.png",
    adaptiveBackground: "#d97706",
  },
  preview: {
    appName: "Kindle Drop Preview",
    scheme: "kindledrop-preview",
    androidPackage: "com.listlessbird.kindledrop.preview",
    icon: "./assets/icon-preview.png",
    adaptiveBackground: "#7c3aed",
  },
  production: {
    appName: "Kindle Drop",
    scheme: "kindledrop",
    androidPackage: "com.listlessbird.kindledrop",
    icon: "./assets/icon-production.png",
    adaptiveBackground: "#0891b2",
  },
} satisfies Record<AppVariant, VariantConfig>;

const isAppVariant = (value: string | undefined): value is AppVariant =>
  APP_VARIANTS.some((variant) => variant === value);

const APP_VARIANT: AppVariant = isAppVariant(process.env.APP_VARIANT)
  ? process.env.APP_VARIANT
  : "production";

const variant = VARIANT_CONFIG[APP_VARIANT];

// `eas init` links the Expo project. Until then OTA updates stay off and builds still work.
const easProjectId = process.env.KD_EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: variant.appName,
  slug: "kindle-drop",
  platforms: ["android"],
  scheme: variant.scheme,
  version: "0.1.0",
  runtimeVersion: {
    // Dev launches skip fingerprinting. Preview and production OTAs only reach binaries whose native
    // fingerprint matches.
    policy: APP_VARIANT === "development" ? "appVersion" : "fingerprint",
  },
  orientation: "portrait",
  icon: variant.icon,
  userInterfaceStyle: "automatic",
  updates: easProjectId
    ? {
        enabled: true,
        url: `https://u.expo.dev/${easProjectId}`,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  android: {
    package: variant.androidPackage,
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      monochromeImage: "./assets/android-icon-foreground.png",
      backgroundColor: variant.adaptiveBackground,
    },
    // JS back dispatch on Android 13-15 also needs withAndroidPredictiveBackCompat.
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    "expo-asset",
    "expo-font",
    [
      "expo-splash-screen",
      {
        image: "./assets/android-icon-foreground.png",
        imageWidth: 288,
        backgroundColor: "#ffffff",
        dark: { backgroundColor: "#0a0a0a" },
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          // SDK 58 lacks Kotlin 2.3's runtime-inert annotation.
          extraProguardRules: "-dontwarn kotlin.MustUseReturnValues",
        },
      },
    ],
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidInputBackground.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
  ],
  extra: { appVariant: APP_VARIANT },
  experiments: {
    // Metro only runs babel-plugin-react-compiler when this is set. src/reactCompilerCoverage.test.ts
    // checks every source file compiles.
    reactCompiler: true,
  },
};

if (easProjectId) config.extra = { ...config.extra, eas: { projectId: easProjectId } };

export default config;

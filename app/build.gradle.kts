plugins {
    id("com.android.application")
}

android {
    namespace = "kr.polarclock.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "kr.polarclock.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 개인 설치용: 별도 키스토어 없이 디버그 키로 서명해 바로 설치할 수 있게 합니다.
            // Play 스토어에 올릴 때는 자신의 키스토어로 바꾸세요.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
}

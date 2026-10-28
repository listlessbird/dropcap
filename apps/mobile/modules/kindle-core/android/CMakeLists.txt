# Started from ubrn's template; ubrn.config.yaml keeps `ubrn generate` from overwriting it.
cmake_minimum_required(VERSION 3.9.0)
project(KindleCore)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O2 -fexceptions -frtti -fstack-protector-all -Wall -Werror")
# 16 KB pages, required on Android 15+.
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=16384")

execute_process(
    COMMAND node -p "require.resolve('uniffi-bindgen-react-native/package.json')"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    OUTPUT_VARIABLE UNIFFI_BINDGEN_PATH
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
get_filename_component(UNIFFI_BINDGEN_PATH "${UNIFFI_BINDGEN_PATH}" DIRECTORY)

include_directories(
    ../cpp
    ../cpp/generated
    ${UNIFFI_BINDGEN_PATH}/cpp/includes
)

add_library(kindle-drop-kindle-core SHARED
    ../cpp/kindle-drop-kindle-core.cpp
    ../cpp/generated/kindle_core.cpp
    cpp-adapter.cpp
)

# build.gradle's buildRust task writes <dir>/<abi>/libkindle_core.so before CMake runs.
add_library(kindle_core SHARED IMPORTED)
set_target_properties(kindle_core PROPERTIES
    IMPORTED_LOCATION ${KINDLE_CORE_RUST_LIB_DIR}/${ANDROID_ABI}/libkindle_core.so
    IMPORTED_NO_SONAME ON
)

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
find_library(LOGCAT log)

target_link_libraries(kindle-drop-kindle-core
    ReactAndroid::reactnative
    ReactAndroid::jsi
    fbjni::fbjni
    ${LOGCAT}
    kindle_core
)

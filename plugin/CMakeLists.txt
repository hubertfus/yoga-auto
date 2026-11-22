cmake_minimum_required(VERSION 3.24)
project(yoga_auto_plugin VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")  # statyczny CRT — brak zależności od vcredist

set(SCS_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/scs_sdk_1_16" CACHE PATH "SCS SDK root (include/)")
if(NOT EXISTS "${SCS_SDK_DIR}/include/scssdk.h")
  message(FATAL_ERROR "SCS SDK not found in ${SCS_SDK_DIR}")
endif()

add_library(yoga_auto SHARED
  src/plugin.cpp
  src/log.cpp
  src/yoga_auto.def
)
target_include_directories(yoga_auto PRIVATE
  src
  generated
  "${SCS_SDK_DIR}/include"
  "${SCS_SDK_DIR}/include/common"
  "${SCS_SDK_DIR}/include/eurotrucks2"
  "${SCS_SDK_DIR}/include/amtrucks"
)
target_compile_definitions(yoga_auto PRIVATE YOGA_PLUGIN_VERSION="${PROJECT_VERSION}" WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
if(MSVC)
  target_compile_options(yoga_auto PRIVATE /W4 /permissive- /utf-8)
endif()
set_target_properties(yoga_auto PROPERTIES OUTPUT_NAME "yoga_auto")

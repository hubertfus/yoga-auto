cmake_minimum_required(VERSION 3.24)
project(yoga_auto_plugin VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")  # statyczny CRT — brak zależności od vcredist

set(SCS_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/scs_sdk_1_16" CACHE PATH "SCS SDK root (include/)")
if(NOT EXISTS "${SCS_SDK_DIR}/include/scssdk.h")
  message(FATAL_ERROR "SCS SDK not found in ${SCS_SDK_DIR}")
endif()

set(SDK_INCLUDES
  "${SCS_SDK_DIR}/include"
  "${SCS_SDK_DIR}/include/common"
  "${SCS_SDK_DIR}/include/eurotrucks2"
  "${SCS_SDK_DIR}/include/amtrucks"
)
set(COMMON_DEFS WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)

function(yoga_warnings target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /WX /wd4324 /permissive- /utf-8 /EHsc)
  endif()
endfunction()

# ── rdzeń: logika bez zależności od SDK-callbacków i WinAPI (testowalna) ──
add_library(yoga_core STATIC
  src/core/json.cpp
  src/core/framing.cpp
  src/core/value.cpp
  src/core/events.cpp
  src/core/input_device.cpp
  src/core/core.cpp
  src/core/ipc_msgs.cpp
  src/core/session.cpp
)
target_include_directories(yoga_core PUBLIC src/core generated)
target_include_directories(yoga_core SYSTEM PUBLIC ${SDK_INCLUDES})
target_compile_definitions(yoga_core PUBLIC ${COMMON_DEFS})
yoga_warnings(yoga_core)

# ── warstwa WinAPI: log, ini, serwer pipe ──
add_library(yoga_win STATIC
  src/log.cpp
  src/config.cpp
  src/pipe_server.cpp
)
target_include_directories(yoga_win PUBLIC src)
target_link_libraries(yoga_win PUBLIC yoga_core advapi32 shell32 ole32)
yoga_warnings(yoga_win)

# ── DLL pluginu ──
add_library(yoga_auto SHARED
  src/plugin.cpp
  src/yoga_auto.def
)
target_link_libraries(yoga_auto PRIVATE yoga_win version)
target_compile_definitions(yoga_auto PRIVATE YOGA_PLUGIN_VERSION="${PROJECT_VERSION}")
yoga_warnings(yoga_auto)
set_target_properties(yoga_auto PROPERTIES OUTPUT_NAME "yoga_auto")

# ── narzędzie: podgląd ramek IPC i wysyłanie komend ──
add_executable(pipe-dump tools/pipe-dump.cpp)
target_include_directories(pipe-dump PRIVATE src)
target_link_libraries(pipe-dump PRIVATE yoga_core)
yoga_warnings(pipe-dump)

# ── testy jednostkowe (doctest, vendorowany) ──
enable_testing()
add_executable(yoga_tests
  tests/test_main.cpp
  tests/test_spsc.cpp
  tests/test_json.cpp
  tests/test_ipc.cpp
  tests/test_input.cpp
  tests/test_session.cpp
  tests/test_config.cpp
)
target_include_directories(yoga_tests SYSTEM PRIVATE third_party/doctest)
target_include_directories(yoga_tests PRIVATE tests)
target_link_libraries(yoga_tests PRIVATE yoga_win)
target_compile_definitions(yoga_tests PRIVATE
  FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../shared/protocol/fixtures/ipc")
yoga_warnings(yoga_tests)
add_test(NAME yoga_tests COMMAND yoga_tests)

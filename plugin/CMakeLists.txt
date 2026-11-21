# Dipogon as a plugin: VST3, AU and Standalone on macOS; VST3 and Standalone on Windows (WebView2) and Linux
# (webkit2gtk). Before configuring, from plugin/:
#   npm install && node tools/gen-data.mjs && node tools/bundle.mjs
# (gen-data writes src/gen/LxrData.h from the web app's JS; bundle gathers the page into build/web.) Then:
#   cmake -B build/cmake -G Xcode -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" && cmake --build build/cmake --config Release
cmake_minimum_required(VERSION 3.22)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
project(LXR_AFX VERSION 0.1.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(juce GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.4 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(juce)

set(JSON_HPP ${CMAKE_CURRENT_SOURCE_DIR}/third_party/json.hpp)
if(NOT EXISTS ${JSON_HPP})
  file(DOWNLOAD https://github.com/nlohmann/json/releases/download/v3.11.3/json.hpp ${JSON_HPP}
       EXPECTED_HASH SHA256=9bea4c8066ef4a1c206b2be5a36302f8926f7fdc6087af5d20b417d0cf103ea6)
endif()
foreach(f src/gen/LxrData.h build/web/index.html)
  if(NOT EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/${f})
    message(FATAL_ERROR "${f} is missing: run `npm install && node tools/gen-data.mjs && node tools/bundle.mjs` in plugin/ first")
  endif()
endforeach()

# the page, zipped (the plugin serves it to its webview from memory)
set(WEB_ZIP ${CMAKE_CURRENT_BINARY_DIR}/web.zip)
file(REMOVE ${WEB_ZIP})
find_program(ZIP_EXE zip)
if(ZIP_EXE)
  execute_process(COMMAND ${ZIP_EXE} -q -r -X ${WEB_ZIP} . WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/build/web RESULT_VARIABLE zipped)
else()  # (Windows has no zip: CMake's own makes the same archive)
  file(GLOB_RECURSE WEB_FILES RELATIVE ${CMAKE_CURRENT_SOURCE_DIR}/build/web ${CMAKE_CURRENT_SOURCE_DIR}/build/web/*)
  execute_process(COMMAND ${CMAKE_COMMAND} -E tar cf ${WEB_ZIP} --format=zip ${WEB_FILES} WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/build/web RESULT_VARIABLE zipped)
endif()
if(NOT zipped EQUAL 0)
  message(FATAL_ERROR "couldn't zip build/web")
endif()
juce_add_binary_data(LxrWeb HEADER_NAME BinaryData.h NAMESPACE BinaryData SOURCES ${WEB_ZIP} js/shim.js)

if(APPLE)
  set(LXR_FORMATS VST3 AU Standalone)
else()
  set(LXR_FORMATS VST3 Standalone)
endif()
if(WIN32)
  set(LXR_WEBVIEW2 TRUE)
else()
  set(LXR_WEBVIEW2 FALSE)
endif()

juce_add_plugin(LXR_AFX
  PRODUCT_NAME "Dipogon"
  COMPANY_NAME "Dipogon"
  BUNDLE_ID io.github.johnnyhawk02.dipogon
  # (the two codes are the ones from when it was called LXR-AFX: they make the plugin the same one to a DAW, so old projects open in it)
  PLUGIN_MANUFACTURER_CODE Lxaf
  PLUGIN_CODE Lxr1
  FORMATS ${LXR_FORMATS}
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS FALSE
  NEEDS_WEB_BROWSER TRUE
  NEEDS_WEBVIEW2 ${LXR_WEBVIEW2}
  COPY_PLUGIN_AFTER_BUILD FALSE
  VST3_CATEGORIES Instrument Drum
  AU_MAIN_TYPE kAudioUnitType_MusicDevice)

target_sources(LXR_AFX PRIVATE
  src/plugin/PluginProcessor.cpp src/plugin/PluginEditor.cpp
  src/engine/Dsp.cpp src/engine/Instrument.cpp src/engine/LxrEngine.cpp src/engine/Wavetables.cpp)

target_compile_definitions(LXR_AFX PUBLIC
  JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_DISPLAY_SPLASH_SCREEN=0)
if(WIN32)  # (WebView2 linked in, so the plugin needs no WebView2Loader.dll beside it)
  target_compile_definitions(LXR_AFX PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

# the engine is a sample-exact port of the JS: no fused multiply-adds the JS doesn't do, no fast maths
if(MSVC)
  set(LXR_EXACT_FP "/fp:precise")
else()
  set(LXR_EXACT_FP "-ffp-contract=off;-fno-fast-math")
endif()
set_source_files_properties(src/engine/Dsp.cpp src/engine/Instrument.cpp src/engine/LxrEngine.cpp src/engine/Wavetables.cpp
  PROPERTIES COMPILE_OPTIONS "${LXR_EXACT_FP}")

target_link_libraries(LXR_AFX PRIVATE LxrWeb juce::juce_audio_utils juce::juce_gui_extra
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# the parity tool (plugin/test/parity.mjs): the engine alone, against the JS
add_executable(lxr_parity test/parity-cli.cpp src/engine/Dsp.cpp src/engine/Instrument.cpp src/engine/LxrEngine.cpp src/engine/Wavetables.cpp)
if(MSVC)
  target_compile_options(lxr_parity PRIVATE /O2 /fp:precise)
else()
  target_compile_options(lxr_parity PRIVATE -O2 -ffp-contract=off -fno-fast-math)
endif()

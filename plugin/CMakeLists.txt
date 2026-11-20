# LXR-AFX as a plugin (VST3, AU, Standalone) for macOS. Before configuring, from plugin/:
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
execute_process(COMMAND zip -q -r -X ${WEB_ZIP} . WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/build/web RESULT_VARIABLE zipped)
if(NOT zipped EQUAL 0)
  message(FATAL_ERROR "couldn't zip build/web")
endif()
juce_add_binary_data(LxrWeb HEADER_NAME BinaryData.h NAMESPACE BinaryData SOURCES ${WEB_ZIP} js/shim.js)

juce_add_plugin(LXR_AFX
  PRODUCT_NAME "LXR-AFX"
  COMPANY_NAME "LXR-AFX"
  BUNDLE_ID io.github.johnnyhawk02.lxrafx
  PLUGIN_MANUFACTURER_CODE Lxaf
  PLUGIN_CODE Lxr1
  FORMATS VST3 AU Standalone
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  EDITOR_WANTS_KEYBOARD_FOCUS TRUE
  NEEDS_WEB_BROWSER TRUE
  COPY_PLUGIN_AFTER_BUILD FALSE
  VST3_CATEGORIES Instrument Drum
  AU_MAIN_TYPE kAudioUnitType_MusicDevice)

target_sources(LXR_AFX PRIVATE
  src/plugin/PluginProcessor.cpp src/plugin/PluginEditor.cpp
  src/engine/Dsp.cpp src/engine/Instrument.cpp src/engine/LxrEngine.cpp src/engine/Wavetables.cpp)

target_compile_definitions(LXR_AFX PUBLIC
  JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_DISPLAY_SPLASH_SCREEN=0)

# the engine is a sample-exact port of the JS: no fused multiply-adds the JS doesn't do, no fast maths
set_source_files_properties(src/engine/Dsp.cpp src/engine/Instrument.cpp src/engine/LxrEngine.cpp src/engine/Wavetables.cpp
  PROPERTIES COMPILE_OPTIONS "-ffp-contract=off;-fno-fast-math")

target_link_libraries(LXR_AFX PRIVATE LxrWeb juce::juce_audio_utils juce::juce_gui_extra
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags juce::juce_recommended_warning_flags)

# the parity tool (plugin/test/parity.mjs): the engine alone, against the JS
add_executable(lxr_parity test/parity-cli.cpp src/engine/Dsp.cpp src/engine/Instrument.cpp src/engine/LxrEngine.cpp src/engine/Wavetables.cpp)
target_compile_options(lxr_parity PRIVATE -O2 -ffp-contract=off -fno-fast-math)

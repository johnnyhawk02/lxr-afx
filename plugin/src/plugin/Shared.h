// The page's settings that aren't one plugin's sound (the LOOK, the knob style, presets, saved sounds...: its
// localStorage lxr-afx-* keys other than lxr-afx-v3), shared by every copy of the plugin, kept in
// ~/Library/Application Support/LXR-AFX/shared.json
#pragma once
#include <juce_core/juce_core.h>

#include <mutex>

#include "../engine/Instrument.h"

namespace lxr::shared {

inline juce::File file() {
  return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
#if JUCE_MAC
      .getChildFile("Application Support")
#endif
      .getChildFile("LXR-AFX").getChildFile("shared.json");
}
inline std::mutex& mx() { static std::mutex m; return m; }
inline json read() {
  try { const auto t = file().loadFileAsString().toStdString(); if (!t.empty()) { auto j = json::parse(t); if (j.is_object()) return j; } } catch (...) {}
  return json::object();
}
inline json load() { std::lock_guard<std::mutex> l(mx()); return read(); }
/** {"k": key, "v": value or null} from the page */
inline void set(const std::string& message) {
  try {
    const auto m = json::parse(message);
    if (!m.is_object() || !m.contains("k") || !m["k"].is_string()) return;
    std::lock_guard<std::mutex> l(mx());
    json all = read();
    if (m.contains("v") && m["v"].is_string()) all[m["k"].get<std::string>()] = m["v"]; else all.erase(m["k"].get<std::string>());
    const auto f = file();
    f.getParentDirectory().createDirectory();
    f.replaceWithText(juce::String::fromUTF8(all.dump(-1, ' ', false, json::error_handler_t::replace).c_str()));
  } catch (...) {}
}

}  // namespace lxr::shared

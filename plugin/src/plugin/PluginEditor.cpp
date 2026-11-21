#include "PluginEditor.h"

#include <BinaryData.h>

#include "Shared.h"

#include <map>
#include <mutex>
#if JUCE_MAC
#include <CoreFoundation/CoreFoundation.h>
#include <objc/message.h>
#include <objc/runtime.h>
#endif

namespace {
// the page's files, from web.zip (plugin/tools/bundle.mjs makes it from the repo's web app)
juce::ZipFile& webZip() {
  static juce::ZipFile zip(new juce::MemoryInputStream(BinaryData::web_zip, (size_t)BinaryData::web_zipSize, false), true);
  return zip;
}
const char* mimeOf(const juce::String& path) {
  const auto e = path.fromLastOccurrenceOf(".", false, false).toLowerCase();
  if (e == "html") return "text/html";
  if (e == "js" || e == "mjs") return "text/javascript";
  if (e == "css") return "text/css";
  if (e == "json") return "application/json";
  if (e == "svg") return "image/svg+xml";
  if (e == "png") return "image/png";
  if (e == "jpg" || e == "jpeg") return "image/jpeg";
  if (e == "woff2") return "font/woff2";
  if (e == "woff") return "font/woff";
  if (e == "ttf") return "font/ttf";
  if (e == "wav") return "audio/wav";
  return "application/octet-stream";
}
// each file is unzipped once and kept, so the next page (another copy of the plugin, a reloaded project) loads at once
std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url) {
  auto path = url.upToFirstOccurrenceOf("?", false, false).upToFirstOccurrenceOf("#", false, false);
  path = juce::URL::removeEscapeChars(path).trimCharactersAtStart("/");
  if (path.isEmpty()) path = "index.html";
  static std::mutex mx;
  static std::map<juce::String, juce::WebBrowserComponent::Resource> cache;
  std::lock_guard<std::mutex> l(mx);
  if (auto it = cache.find(path); it != cache.end()) return it->second;
  auto& zip = webZip();
  const int i = zip.getIndexOfFileName(path);
  if (i < 0) return std::nullopt;
  std::unique_ptr<juce::InputStream> in(zip.createStreamForEntry(i));
  if (!in) return std::nullopt;
  juce::MemoryBlock mb; in->readIntoMemoryBlock(mb);
  std::vector<std::byte> data(mb.getSize());
  std::memcpy(data.data(), mb.getData(), mb.getSize());
  return cache.emplace(path, juce::WebBrowserComponent::Resource{std::move(data), mimeOf(path)}).first->second;
}

std::string sharedText(const lxr::json& j) { return j.dump(-1, ' ', false, lxr::json::error_handler_t::replace); }

// the page's panel colour (it sends it: plugin/js/shim.js), kept for the next window, by every copy of the plugin
juce::File panelFile() { return lxr::shared::file().getSiblingFile("panel.txt"); }
std::atomic<juce::uint32>& panelArgb() {
  static std::atomic<juce::uint32> c{[] {
    const auto t = panelFile().loadFileAsString().trim();
    return t.isNotEmpty() ? (juce::uint32)t.getHexValue32() : 0xffc8ecdfu;  // (LCD in MINT, the default look)
  }()};
  return c;
}
void panelFromPage(const juce::String& rgb) {  // "200 236 223"
  auto p = juce::StringArray::fromTokens(rgb, " ,", "");
  p.removeEmptyStrings();
  if (p.size() < 3) return;
  const auto c = juce::Colour((juce::uint8)p[0].getIntValue(), (juce::uint8)p[1].getIntValue(), (juce::uint8)p[2].getIntValue()).getARGB();
  if (panelArgb().exchange(c) == c) return;
  panelFile().getParentDirectory().createDirectory();
  panelFile().replaceWithText(juce::String::toHexString((int)c));
}

// The webview. JUCE loads the page again whenever a browser is put back on screen (it keeps the last URL for that),
// which would throw away the page we kept for the next window: here it is loaded once, by LxrEditor::open(), and the
// page (withKeepPageLoadedWhenBrowserIsHidden) carries on, off screen, while the window is shut.
class Page : public juce::WebBrowserComponent {
 public:
  using WebBrowserComponent::WebBrowserComponent;
  void parentHierarchyChanged() override {}
  void visibilityChanged() override {}
};

// The webview draws no background of its own, so until the page's first paint the window shows the editor's paint
// (the panel colour) instead of the webview's empty black/white
void seeThrough(juce::Component& browser) {
#if JUCE_MAC
  for (auto* c : browser.getChildren())
    if (auto* ns = dynamic_cast<juce::NSViewComponent*>(c))
      if (auto* v = reinterpret_cast<id>(ns->getView()); v != nullptr && class_respondsToSelector(object_getClass(v), sel_registerName("_setDrawsBackground:")))
        reinterpret_cast<void (*)(id, SEL, CFTypeRef, CFStringRef)>(objc_msgSend)(v, sel_registerName("setValue:forKey:"), kCFBooleanFalse, CFSTR("drawsBackground"));
#else
  juce::ignoreUnused(browser);
#endif
}
}  // namespace

LxrEditor::LxrEditor(LxrProcessor& p) : AudioProcessorEditor(&p), proc(p) {
  // the page is a 1780 x 1040 panel (a row taller than 16:8 for the MACRO knobs) that scales itself to fit
  setOpaque(true);
  setResizable(true, true);
  setResizeLimits(712, 416, 3560, 2080);
  if (auto* c = getConstrainer()) c->setFixedAspectRatio(1780.0 / 1040.0);
  setSize(1424, 832);
  proc.takeMidi();  // (what the DAW played while the window was shut is old news for the page)
  // the page this copy had open last time, as it was, unless a project has been loaded since or another copy of the
  // plugin changed the shared settings (the LOOK, presets...): then a fresh one
  if (proc.page && proc.pageGen == proc.generation() && proc.pageShared == sharedText(lxr::shared::load())) show();
  else open();
  startTimerHz(30);
}
LxrEditor::~LxrEditor() {
  stopTimer();
  if (web) removeChildComponent(web);  // (off screen, still loaded, for the next window)
}

void LxrEditor::paint(juce::Graphics& g) { g.fillAll(juce::Colour(panelArgb().load())); }

void LxrEditor::open() {
  if (web) removeChildComponent(web);
  web = nullptr;
  proc.page.reset();
  const int g = proc.generation();
  const auto shared = lxr::shared::load();
  const lxr::json host = {{"store", proc.store()}, {"shared", shared}, {"rate", proc.rate()}};
  const juce::String script = "window.lxrHost = " + juce::String(host.dump(-1, ' ', false, lxr::json::error_handler_t::replace)) + ";\n" +
                              juce::String::fromUTF8(BinaryData::shim_js, BinaryData::shim_jsSize);
  // (the page outlives this editor: its listeners talk to the processor, and a page from before a project was loaded
  // is no longer this plugin's sound, so what it says is dropped)
  auto* pr = &proc;
  auto opts = juce::WebBrowserComponent::Options{}
                  .withNativeIntegrationEnabled()
                  .withKeepPageLoadedWhenBrowserIsHidden()
                  .withResourceProvider([](const juce::String& url) { return resource(url); })
                  .withUserScript(script)
                  .withEventListener("dsp", [pr, g](const juce::var& v) { if (pr->generation() == g) pr->fromPage(v.toString()); })
                  .withEventListener("state", [pr, g](const juce::var& v) { if (pr->generation() == g) pr->pageState(v.toString()); })
                  .withEventListener("shared", [pr](const juce::var& v) {
                    lxr::shared::set(v.toString().toStdString());
                    pr->pageShared = sharedText(lxr::shared::load());
                  })
                  .withEventListener("panel", [](const juce::var& v) { panelFromPage(v.toString()); })
                  .withEventListener("hello", [](const juce::var&) {});
  proc.page = std::make_unique<Page>(opts);
  proc.pageGen = g;
  proc.pageShared = sharedText(shared);
  seeThrough(*proc.page);
  proc.page->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
  show();
}

void LxrEditor::show() {
  web = proc.page.get();
  addAndMakeVisible(*web);
  resized();
}

void LxrEditor::resized() { if (web) web->setBounds(getLocalBounds()); }

void LxrEditor::timerCallback() {
  if (proc.generation() != proc.pageGen) { open(); return; }  // a project was loaded: its page
  if (!web) return;
  const auto m = proc.takeMidi();
  if (!m.empty()) web->emitEventIfBrowserIsVisible("midi", juce::String(m));
  const auto p = proc.takePeaks();
  if (!p.empty()) web->emitEventIfBrowserIsVisible("peaks", juce::String(p));
}

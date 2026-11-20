#include "PluginEditor.h"

#include <BinaryData.h>

#include "Shared.h"

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
std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url) {
  auto path = url.upToFirstOccurrenceOf("?", false, false).upToFirstOccurrenceOf("#", false, false);
  path = juce::URL::removeEscapeChars(path).trimCharactersAtStart("/");
  if (path.isEmpty()) path = "index.html";
  auto& zip = webZip();
  const int i = zip.getIndexOfFileName(path);
  if (i < 0) return std::nullopt;
  std::unique_ptr<juce::InputStream> in(zip.createStreamForEntry(i));
  if (!in) return std::nullopt;
  juce::MemoryBlock mb; in->readIntoMemoryBlock(mb);
  std::vector<std::byte> data(mb.getSize());
  std::memcpy(data.data(), mb.getData(), mb.getSize());
  return juce::WebBrowserComponent::Resource{std::move(data), mimeOf(path)};
}
}  // namespace

LxrEditor::LxrEditor(LxrProcessor& p) : AudioProcessorEditor(&p), proc(p) {
  // the page is a 16:8 panel that scales itself to fit
  setResizable(true, true);
  setResizeLimits(712, 356, 3560, 1780);
  if (auto* c = getConstrainer()) c->setFixedAspectRatio(2.0);
  setSize(1424, 712);
  open();
  startTimerHz(30);
}
LxrEditor::~LxrEditor() { stopTimer(); }

void LxrEditor::open() {
  gen = proc.generation();
  removeAllChildren();
  web.reset();
  const lxr::json host = {{"store", proc.store()}, {"shared", lxr::shared::load()}, {"rate", proc.rate()}};
  const juce::String script = "window.lxrHost = " + juce::String(host.dump(-1, ' ', false, lxr::json::error_handler_t::replace)) + ";\n" +
                              juce::String::fromUTF8(BinaryData::shim_js, BinaryData::shim_jsSize);
  auto opts = juce::WebBrowserComponent::Options{}
                  .withNativeIntegrationEnabled()
                  .withKeepPageLoadedWhenBrowserIsHidden()
                  .withResourceProvider([](const juce::String& url) { return resource(url); })
                  .withUserScript(script)
                  .withEventListener("dsp", [this](const juce::var& v) { proc.fromPage(v.toString()); })
                  .withEventListener("state", [this](const juce::var& v) { proc.pageState(v.toString()); })
                  .withEventListener("shared", [](const juce::var& v) { lxr::shared::set(v.toString().toStdString()); })
                  .withEventListener("hello", [](const juce::var&) {});
  web = std::make_unique<juce::WebBrowserComponent>(opts);
  addAndMakeVisible(*web);
  resized();
  web->goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

void LxrEditor::resized() { if (web) web->setBounds(getLocalBounds()); }

void LxrEditor::timerCallback() {
  if (proc.generation() != gen) { open(); return; }  // a project was loaded: its page
  if (!web) return;
  const auto m = proc.takeMidi();
  if (!m.empty()) web->emitEventIfBrowserIsVisible("midi", juce::String(m));
  const auto p = proc.takePeaks();
  if (!p.empty()) web->emitEventIfBrowserIsVisible("peaks", juce::String(p));
}

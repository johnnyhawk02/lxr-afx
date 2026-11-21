// The C++ engine on a script, for plugin/test/parity.mjs: reads JSON lines from stdin, writes the audio (interleaved
// float32, left then right) to stdout.
//   {"op":"init","sr":48000}  {"op":"msg","m":{...}}  {"op":"midi","d":[144,60,100]}  {"op":"render","n":128}
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

#include "../src/engine/Dsp.h"
#include "../src/engine/Wavetables.h"

int main() {
  std::ios::sync_with_stdio(false);
#ifdef _WIN32
  _setmode(_fileno(stdout), _O_BINARY);  // (or every 0x0a byte of the audio gets a 0x0d put before it)
#endif
  lxr::buildAllTables();
  lxr::Dsp dsp;
  std::vector<float> L(1 << 16), R(1 << 16), out;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    auto j = lxr::json::parse(line);
    const std::string op = j["op"];
    if (op == "init") { dsp.init(j["sr"].get<double>()); dsp.retable(); }
    else if (op == "msg") dsp.msg(j["m"]);
    else if (op == "midi") dsp.midi(j["d"][0], j["d"][1], j["d"][2]);
    else if (op == "render") {
      const int n = j["n"];
      dsp.render(L.data(), R.data(), n);
      out.resize(2 * n);
      for (int i = 0; i < n; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
      std::fwrite(out.data(), sizeof(float), out.size(), stdout);
    } else if (op == "poll") { std::string p = dsp.poll(); std::fprintf(stderr, "%s\n", p.c_str()); }
  }
  if (!dsp.lastError.empty()) std::fprintf(stderr, "error: %s\n", dsp.lastError.c_str());
  return 0;
}

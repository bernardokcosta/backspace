#include "source_color.h"

#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>

void sourceColorPolicyTests() {
    using backspace::CaptureColor;
    auto require = [](bool value, const char* message) { if (!value) throw std::runtime_error(message); };
    require(backspace::compatibleCaptureColor({false, 80}, {false, 80}), "SDR displays should agree");
    require(backspace::compatibleCaptureColor({true, 203}, {true, 203}), "Same HDR white should agree");
    require(!backspace::compatibleCaptureColor({true, 203}, {false, 80}), "Mixed HDR/SDR must not be guessed");
    require(!backspace::compatibleCaptureColor({true, 203}, {true, 320}), "Different display white must not be guessed");
    require(!backspace::compatibleCaptureColor({true, std::numeric_limits<float>::quiet_NaN()}, {true, 203}), "Non-finite white accepted");
    backspace::SourceColorReader reader;
    bool rejected = false;
    try { reader.monitor(nullptr); } catch (const std::runtime_error&) { rejected = true; }
    require(rejected, "Missing monitor accepted");
    rejected = false;
    try { reader.window(nullptr); } catch (const std::runtime_error&) { rejected = true; }
    require(rejected, "Missing window accepted");
    std::cout << "Native source color policy tests passed\n";
}

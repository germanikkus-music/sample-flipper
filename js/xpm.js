// MPC drum program (.xpm) writer. The layout copies Akai's own drum kits
// (File_Version 2.1, the XML format MPC OS 2.x and 3.x both load): 128
// instruments with 4 layers each, a pad->note map and a pad->group map.
// Samples are referenced by name (no extension) and must sit in the same
// folder as the .xpm.
(function (SF) {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function layer(n, sampleName, frames) {
    const used = !!sampleName;
    return [
      '          <Layer number="' + n + '">',
      '            <Active>True</Active>',
      '            <Volume>1.000000</Volume>',
      '            <Pan>0.500000</Pan>',
      '            <Pitch>0.000000</Pitch>',
      '            <TuneCoarse>0</TuneCoarse>',
      '            <TuneFine>0</TuneFine>',
      '            <VelStart>0</VelStart>',
      '            <VelEnd>127</VelEnd>',
      '            <SampleStart>0</SampleStart>',
      '            <SampleEnd>0</SampleEnd>',
      '            <LoopStart>0</LoopStart>',
      '            <LoopEnd>0</LoopEnd>',
      '            <LoopCrossfadeLength>0</LoopCrossfadeLength>',
      '            <LoopTune>0</LoopTune>',
      '            <RootNote>0</RootNote>',
      '            <KeyTrack>False</KeyTrack>',
      '            <SampleName>' + (used ? esc(sampleName) : '') + '</SampleName>',
      '            <PitchRandom>0.000000</PitchRandom>',
      '            <VolumeRandom>0.000000</VolumeRandom>',
      '            <PanRandom>0.000000</PanRandom>',
      '            <OffsetRandom>0.000000</OffsetRandom>',
      '            <SampleFile></SampleFile>',
      '            <SliceIndex>129</SliceIndex>',
      '            <Direction>0</Direction>',
      '            <Offset>0</Offset>',
      '            <SliceStart>0</SliceStart>',
      '            <SliceEnd>' + (used ? frames : 0) + '</SliceEnd>',
      '            <SliceLoopStart>0</SliceLoopStart>',
      '            <SliceLoop>0</SliceLoop>',
      '            <SliceLoopCrossFadeLength>' + (used ? 0 : -1) + '</SliceLoopCrossFadeLength>',
      '            <SliceTailPosition>0.500000</SliceTailPosition>',
      '            <SliceTailLength>0.000000</SliceTailLength>',
      '          </Layer>',
    ].join('\n');
  }

  function instrument(n, pad) {
    const lines = [
      '      <Instrument number="' + n + '">',
      '        <CueBusEnable>False</CueBusEnable>',
      '        <AudioRoute>',
      '          <AudioRoute>0</AudioRoute>',
      '          <AudioRouteSubIndex>0</AudioRouteSubIndex>',
      '          <AudioRouteChannelBitmap>3</AudioRouteChannelBitmap>',
      '          <InsertsEnabled>True</InsertsEnabled>',
      '        </AudioRoute>',
      '        <Send1>0.000000</Send1>',
      '        <Send2>0.000000</Send2>',
      '        <Send3>0.000000</Send3>',
      '        <Send4>0.000000</Send4>',
      '        <Volume>0.707946</Volume>',
      '        <Mute>False</Mute>',
      '        <Solo>False</Solo>',
      '        <Pan>0.500000</Pan>',
      '        <AutomationFilter>1</AutomationFilter>',
      '        <FilterKeytrack>0.000000</FilterKeytrack>',
      '        <FilterType>0</FilterType>',
      '        <Cutoff>1.000000</Cutoff>',
      '        <Resonance>0.000000</Resonance>',
      '        <FilterEnvAmt>0.000000</FilterEnvAmt>',
      '        <AfterTouchToFilter>0.000000</AfterTouchToFilter>',
      '        <VelocityToFilter>0.000000</VelocityToFilter>',
      '        <VelocityToFilterEnvelope>0.000000</VelocityToFilterEnvelope>',
      '        <VelocityToStart>0.000000</VelocityToStart>',
      '        <VelocityToFilterAttack>0.000000</VelocityToFilterAttack>',
      '        <FilterAttack>0.000000</FilterAttack>',
      '        <FilterDecay>0.047244</FilterDecay>',
      '        <FilterSustain>1.000000</FilterSustain>',
      '        <FilterRelease>0.000000</FilterRelease>',
      '        <FilterAttackCurve>0.375000</FilterAttackCurve>',
      '        <FilterDecayCurve>0.375000</FilterDecayCurve>',
      '        <FilterReleaseCurve>0.375000</FilterReleaseCurve>',
      '        <FilterHold>0.000000</FilterHold>',
      '        <FilterDecayType>True</FilterDecayType>',
      '        <FilterADEnvelope>True</FilterADEnvelope>',
      '        <VolumeHold>0.000000</VolumeHold>',
      '        <VolumeDecayType>True</VolumeDecayType>',
      '        <VolumeADEnvelope>True</VolumeADEnvelope>',
      '        <VolumeAttack>0.000000</VolumeAttack>',
      '        <VolumeDecay>0.047244</VolumeDecay>',
      '        <VolumeSustain>1.000000</VolumeSustain>',
      '        <VolumeRelease>0.000000</VolumeRelease>',
      '        <VolumeAttackCurve>0.375000</VolumeAttackCurve>',
      '        <VolumeDecayCurve>0.375000</VolumeDecayCurve>',
      '        <VolumeReleaseCurve>0.375000</VolumeReleaseCurve>',
      '        <PitchHold>0.000000</PitchHold>',
      '        <PitchDecayType>True</PitchDecayType>',
      '        <PitchADEnvelope>True</PitchADEnvelope>',
      '        <PitchAttack>0.000000</PitchAttack>',
      '        <PitchDecay>0.047244</PitchDecay>',
      '        <PitchSustain>1.000000</PitchSustain>',
      '        <PitchRelease>0.000000</PitchRelease>',
      '        <PitchAttackCurve>0.375000</PitchAttackCurve>',
      '        <PitchDecayCurve>0.375000</PitchDecayCurve>',
      '        <PitchReleaseCurve>0.375000</PitchReleaseCurve>',
      '        <PitchEnvAmount>0.500000</PitchEnvAmount>',
      '        <VelocityToPitch>0.000000</VelocityToPitch>',
      '        <VelocityToVolumeAttack>0.000000</VelocityToVolumeAttack>',
      '        <VelocitySensitivity>0.509140</VelocitySensitivity>',
      '        <VelocityToPan>0.000000</VelocityToPan>',
      '        <RandomizationScale>1.000000</RandomizationScale>',
      '        <AttackRandom>0.000000</AttackRandom>',
      '        <DecayRandom>0.000000</DecayRandom>',
      '        <CutoffRandom>0.000000</CutoffRandom>',
      '        <ResonanceRandom>0.000000</ResonanceRandom>',
      '        <LFO LfoNum="0">',
      '          <Type>Sine</Type>',
      '          <Rate>0.500000</Rate>',
      '          <Sync>0</Sync>',
      '          <Reset>True</Reset>',
      '          <LfoPitch>0.000000</LfoPitch>',
      '          <LfoCutoff>0.000000</LfoCutoff>',
      '          <LfoVolume>0.000000</LfoVolume>',
      '          <LfoPan>0.000000</LfoPan>',
      '        </LFO>',
      '        <DrumPadEffects>',
      '          <DrumPadEffect Num="0" Parameter="0.0" Type="0"/>',
      '          <DrumPadEffect Num="1" Parameter="0.0" Type="9"/>',
      '          <DrumPadEffect Num="2" Parameter="0.0" Type="1"/>',
      '          <DrumPadEffect Num="3" Parameter="0.0" Type="2"/>',
      '          <DrumPadEffect Num="4" Parameter="0.0" Type="3"/>',
      '          <DrumPadEffect Num="5" Parameter="0.0" Type="7"/>',
      '          <DrumPadEffect Num="6" Parameter="0.0" Type="4"/>',
      '          <DrumPadEffect Num="7" Parameter="0.0" Type="13"/>',
      '        </DrumPadEffects>',
      '        <TuneCoarse>0</TuneCoarse>',
      '        <TuneFine>0</TuneFine>',
      '        <Mono>False</Mono>',
      '        <Polyphony>0</Polyphony>',
      '        <LowNote>0</LowNote>',
      '        <HighNote>127</HighNote>',
      '        <IgnoreBaseNote>False</IgnoreBaseNote>',
      '        <ZonePlay>1</ZonePlay>',
      // Choked chops share mute group 1 so each one cuts the last, like the app.
      '        <MuteGroup>' + (pad && pad.choke ? 1 : 0) + '</MuteGroup>',
      '        <MuteTarget1>0</MuteTarget1>',
      '        <MuteTarget2>0</MuteTarget2>',
      '        <MuteTarget3>0</MuteTarget3>',
      '        <MuteTarget4>0</MuteTarget4>',
      '        <SimultTarget1>0</SimultTarget1>',
      '        <SimultTarget2>0</SimultTarget2>',
      '        <SimultTarget3>0</SimultTarget3>',
      '        <SimultTarget4>0</SimultTarget4>',
      '        <TriggerMode>0</TriggerMode>', // One Shot: the whole chop plays per hit
      '        <WarpTempo>20.000000</WarpTempo>',
      '        <BpmLock>True</BpmLock>',
      '        <WarpEnable>False</WarpEnable>',
      '        <StretchPercentage>100</StretchPercentage>',
      '        <EditAllLayers>False</EditAllLayers>',
      '        <Layers>',
      layer(1, pad && pad.sampleName, pad && pad.frames),
      layer(2), layer(3), layer(4),
      '        </Layers>',
      '      </Instrument>',
    ];
    return lines.join('\n');
  }

  function programPads(colors) {
    const pads = {};
    for (let i = 0; i < 128; i++) pads['value' + i] = colors[i] || 0;
    const json = JSON.stringify({
      'ProgramPads-v2.10': {
        Universal: { value0: false },
        Type: { value0: 2 },
        universalPad: 32512,
        pads: pads,
        UnusedPads: { value0: 1 },
      },
    }, null, 4);
    return esc(json);
  }

  // MIDI note the drum program maps to a pad (0 = pad A01 = note 36).
  SF.padNote = function (padIndex) {
    return (padIndex + 36) % 128;
  };

  // MPC pattern (.mpcpattern), the legacy JSON layout used by Akai's drum-kit
  // patterns and the NeoSoul expansion: 960 ticks per quarter note, type 2 =
  // note event with "1" = note, "2" = velocity 0..1, "len" in ticks.
  // notes: [{ tick, pad, velocity (0..1), len }]
  SF.buildMpcPattern = function (notes) {
    // Written by hand rather than JSON.stringify so the key order matches
    // Akai's files ("length" is also bigger than a JS number can hold).
    const sorted = notes.slice().sort(function (a, b) { return a.tick - b.tick || a.pad - b.pad; });
    const lines = sorted.map(function (n) {
      return '            {\n' +
        '                "type": 2,\n' +
        '                "time": ' + Math.round(n.tick) + ',\n' +
        '                "len": ' + Math.round(n.len) + ',\n' +
        '                "1": ' + SF.padNote(n.pad) + ',\n' +
        '                "2": ' + n.velocity.toFixed(6) + ',\n' +
        '                "3": 0,\n' +
        '                "mod": 0,\n' +
        '                "modVal": 0.5,\n' +
        '                "prob": 100,\n' +
        '                "ratchet": 1\n' +
        '            }';
    });
    return '{\n    "pattern": {\n        "length": 9223372036854775807,\n        "events": [\n' +
      lines.join(',\n') + '\n        ]\n    }\n}\n';
  };

  // pads: up to 128 of { sampleName, frames, choke, color (0xRRGGBB) } in pad
  // order (index 0 = pad A01).
  SF.buildXpm = function (programName, pads) {
    const out = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '',
      '<MPCVObject>',
      '  <Version>',
      '    <File_Version>2.1</File_Version>',
      '    <Application>MPC-V</Application>',
      '    <Application_Version>2.15.0.18</Application_Version>',
      '    <Platform>OSX</Platform>',
      '  </Version>',
      '  <Program type="Drum">',
      '    <ProgramName>' + esc(programName) + '</ProgramName>',
      '    <ProgramPads-v2.10>' + programPads(pads.map(function (p) { return p.color; })) + '</ProgramPads-v2.10>',
      '    <CueBusEnable>False</CueBusEnable>',
      '    <AudioRoute>',
      '      <AudioRoute>2</AudioRoute>',
      '      <AudioRouteSubIndex>0</AudioRouteSubIndex>',
      '      <AudioRouteChannelBitmap>3</AudioRouteChannelBitmap>',
      '      <InsertsEnabled>True</InsertsEnabled>',
      '    </AudioRoute>',
      '    <Send1>0.000000</Send1>',
      '    <Send2>0.000000</Send2>',
      '    <Send3>0.000000</Send3>',
      '    <Send4>0.000000</Send4>',
      '    <Volume>0.707946</Volume>',
      '    <Mute>False</Mute>',
      '    <Solo>False</Solo>',
      '    <Pan>0.500000</Pan>',
      '    <AutomationFilter>1</AutomationFilter>',
      '    <Pitch>0.000000</Pitch>',
      '    <TuneCoarse>0</TuneCoarse>',
      '    <TuneFine>0</TuneFine>',
      '    <Mono>False</Mono>',
      '    <Program_Polyphony>0</Program_Polyphony>',
      '    <PortamentoTime>0.000000</PortamentoTime>',
      '    <PortamentoLegato>False</PortamentoLegato>',
      '    <PortamentoQuantized>False</PortamentoQuantized>',
      '    <Program.Xfader.Route>0</Program.Xfader.Route>',
      '    <Instruments>',
    ];
    for (let n = 1; n <= 128; n++) out.push(instrument(n, pads[n - 1]));
    out.push('    </Instruments>', '    <PadNoteMap>');
    // Akai's default: pad 1 = note 36 upward, wrapping past 127 to 0.
    for (let p = 1; p <= 128; p++) {
      out.push('      <PadNote number="' + p + '">', '        <Note>' + ((p + 35) % 128) + '</Note>', '      </PadNote>');
    }
    out.push('    </PadNoteMap>', '    <PadGroupMap>');
    for (let p = 1; p <= 128; p++) {
      out.push('      <PadGroup number="' + p + '">', '        <Group>0</Group>', '      </PadGroup>');
    }
    out.push('    </PadGroupMap>', '  </Program>', '</MPCVObject>', '');
    return out.join('\n');
  };
})(window.SF = window.SF || {});

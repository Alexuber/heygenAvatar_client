import { useEffect, useRef, useState } from "react";
import {
  Configuration,
  NewSessionData,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar";
import "./App.css";
import OpenAI from "openai";

const openaiApiKey = process.env.REACT_APP_OPENAI_API_KEY;
const API_KEY = process.env.REACT_APP_API_KEY;
const openai = new OpenAI({
  apiKey: openaiApiKey,
  dangerouslyAllowBrowser: true,
});

function App() {
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [text, setText] = useState<string>("");
  const [chatGPTText, setChatGPTText] = useState<string>("");
  const [avatarId, setAvatarId] = useState<string>("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [data, setData] = useState<NewSessionData>();
  const [initialized, setInitialized] = useState(false);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [canPlay, setCanPlay] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [selectedAssistant, setSelectedAssistant] = useState<string>("");

  async function fetchAccessToken() {
    try {
      const response = await fetch(
        "https://api.heygen.com/v1/streaming.create_token",
        {
          method: "POST",
          headers: {
            "x-api-key": `${API_KEY}`,
          },
        }
      );
      const result = await response.json();
      console.log("🆑  result:", result);

      const token = result.data.token; // Access the token correctly
      console.log("Access Token:", token); // Log the token to verify
      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
      return "";
    }
  }

  async function grab() {
    if (!selectedAssistant) {
      setDebug("Please select an assistant first.");
      return;
    }
    await updateToken();

    if (!avatar.current) {
      setDebug("Avatar API is not initialized");
      return;
    }

    try {
      console.log("Starting session with avatarId:", avatarId);
      const res = await avatar.current.createStartAvatar(
        {
          newSessionRequest: {
            quality: "low",
            avatarName: avatarId,
            voice: { voiceId: voiceId },
          },
        },
        setDebug
      );
      setData(res);
      setStream(avatar.current.mediaStream);
      setSessionStarted(true); // Set session started to true
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  }

  async function updateToken() {
    const newToken = await fetchAccessToken();
    console.log("Updating Access Token:", newToken); // Log token for debugging
    avatar.current = new StreamingAvatarApi(
      new Configuration({ accessToken: newToken })
    );

    const startTalkCallback = (e: any) => {
      console.log("Avatar started talking", e);
    };

    const stopTalkCallback = (e: any) => {
      console.log("Avatar stopped talking", e);
    };

    console.log("Adding event handlers:", avatar.current);
    avatar.current.addEventHandler("avatar_start_talking", startTalkCallback);
    avatar.current.addEventHandler("avatar_stop_talking", stopTalkCallback);

    setInitialized(true);
  }

  async function stop() {
    if (!initialized || !avatar.current || !data || !data.sessionId) {
      console.error("Avatar API not initialized or session not started");
      return;
    }

    try {
      console.log("Stopping session with sessionId:", data.sessionId);
      await avatar.current.stopAvatar({
        stopSessionRequest: {
          sessionId: data.sessionId,
        },
      });
      console.log("Session stopped successfully");

      setSessionStarted(false); // Set session started to false
      setChatGPTText("");
      setData(undefined); // Clear session data
    } catch (error) {
      console.error("Error stopping avatar session:", error);
    }
  }

  async function handleSpeak() {
    if (!initialized || !avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }
    await avatar.current
      .speak({ taskRequest: { text: text, sessionId: data?.sessionId } })
      .catch((e) => {
        setDebug(e.message);
      });
  }

  async function handleInterrupt() {
    if (!initialized || !avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }
    await avatar.current
      ?.interrupt({ interruptRequest: { sessionId: data?.sessionId } })
      .catch((e) => {
        setDebug(e.message);
      });
  }

  async function handleChatGPT() {
    if (!chatGPTText) {
      setDebug("Please enter text to send to ChatGPT");
      return;
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: chatGPTText },
        ],
      });

      const chatGPTResponse = String(response.choices[0].message.content);
      console.log("ChatGPT Response:", chatGPTResponse);

      if (!initialized || !avatar.current || !data?.sessionId) {
        setDebug("Avatar API not initialized or session not started");
        return;
      }

      await avatar.current
        .speak({
          taskRequest: { text: chatGPTResponse, sessionId: data?.sessionId },
        })
        .catch((e) => {
          setDebug(e.message);
        });

      setChatGPTText(""); // Clear the input text after sending
    } catch (error) {
      console.error("Error communicating with ChatGPT:", error);
    }
  }

  useEffect(() => {
    async function init() {
      const newToken = await fetchAccessToken();
      console.log("Initializing with Access Token:", newToken); // Log token for debugging
      avatar.current = new StreamingAvatarApi(
        new Configuration({ accessToken: newToken, jitterBuffer: 200 })
      );
      setInitialized(true); // Set initialized to true
      // await grab(); // Automatically start the session
    }
    init();
  }, []);

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
        setDebug("Playing");
      };
    }
  }, [mediaStream, stream]);

  const startRecording = () => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        mediaRecorder.current = new MediaRecorder(stream);
        mediaRecorder.current.ondataavailable = (event) => {
          audioChunks.current.push(event.data);
        };
        mediaRecorder.current.onstop = () => {
          const audioBlob = new Blob(audioChunks.current, {
            type: "audio/wav",
          });
          setAudioBlob(audioBlob);
          audioChunks.current = [];
          transcribeAudio(audioBlob);
        };
        mediaRecorder.current.start();
        setRecording(true);
      })
      .catch((error) => {
        console.error("Error accessing microphone:", error);
      });
  };

  const stopRecording = () => {
    if (mediaRecorder.current) {
      mediaRecorder.current.stop();
      setRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      // Convert Blob to File
      const audioFile = new File([audioBlob], "recording.wav", {
        type: "audio/wav",
      });

      const response = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file: audioFile,
      });
      const transcription = response.text;
      console.log("Transcription:", transcription);
      setChatGPTText(transcription);
    } catch (error) {
      console.error("Error transcribing audio:", error);
    }
  };

  const handleAssistantSelect = (id: string) => {
    setAvatarId(id);
    setSelectedAssistant(id);
    console.log("Selected avatarId:", id); // Log selected avatar ID
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      handleChatGPT();
    }
  };

  return (
    <div className="HeyGenStreamingAvatar">
      <div className="container">
        <header className="App-header">
          <div className="MediaPlayer">
            {!sessionStarted && (
              <div className="selectWrapper">
                <div className="select">
                  <h2 className="selectTitle">Please choose your assistant</h2>
                  <ul className="selectList">
                    <li
                      className={`selectItem ${
                        selectedAssistant === "Kristin_public_2_20240108"
                          ? "selected"
                          : ""
                      }`}
                      onClick={() =>
                        handleAssistantSelect("Kristin_public_2_20240108")
                      }
                    >
                      <img
                        src="https://files2.heygen.ai/avatar/v3/f94222a03cee4adaa110761a374cfadc_13181/preview_talk_5_medium.webp"
                        alt="assistant-1 pic"
                        className="selectImg"
                        assistant-id="Kristin_public_2_20240108"
                        width="150px"
                      />
                      <span className="listName">Anna</span>
                    </li>
                    <li
                      className={`selectItem ${
                        selectedAssistant === "Lily_public_pro1_20230614"
                          ? "selected"
                          : ""
                      }`}
                      onClick={() =>
                        handleAssistantSelect("Lily_public_pro1_20230614")
                      }
                    >
                      <img
                        src="https://files2.heygen.ai/avatar/v3/51267c0f0f2045518a8c66bb1709bf2a_2654/preview_target_medium.webp"
                        alt="assistant-2 pic"
                        className="selectImg"
                        assistant-id="Lily_public_pro1_20230614"
                        width="150px"
                      />
                      <span className="listName">Lily</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}
            <video
              playsInline
              autoPlay
              width={`100%`}
              height={400}
              ref={mediaStream}
              onCanPlay={() => {
                setCanPlay(true);
              }}
            />
          </div>
          <div className="Actions">
            <button
              onClick={handleChatGPT}
              style={{
                borderRadius: chatGPTText ? "50%" : "none",
                border: chatGPTText ? "2px solid green" : "none",
              }}
              disabled={!sessionStarted || !selectedAssistant}
            >
              <svg
                className={`icon ${chatGPTText ? "highlight" : ""}`}
                width="30"
                height="30"
                style={{
                  fill: chatGPTText ? "green" : "black",
                }}
              >
                <use href="/symbol-defs.svg#icon-circle-right"></use>
              </svg>
            </button>
            <input
              className="InputField"
              placeholder="Let's chat!"
              value={chatGPTText}
              onChange={(v) => setChatGPTText(v.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus // Set focus on input field
              disabled={!sessionStarted || !selectedAssistant}
            />
            <button
              onClick={recording ? stopRecording : startRecording}
              style={{
                borderRadius: recording ? "50%" : "none",
                border: recording ? "2px solid red" : "none",
              }}
              disabled={!sessionStarted || !selectedAssistant}
            >
              <svg
                className={`icon ${recording ? "highlight" : ""}`}
                width="20"
                height="20"
                style={{
                  fill: recording ? "red" : "black",
                }}
              >
                <use
                  href={
                    recording
                      ? "/symbol-defs.svg#icon-stop2"
                      : "/symbol-defs.svg#icon-mic"
                  }
                ></use>
              </svg>
            </button>
          </div>
          <div className="Actions">
            <button
              onClick={sessionStarted ? stop : grab}
              className={`startBtn ${sessionStarted ? "stopBtn" : ""}`}
              disabled={!selectedAssistant}
            >
              {sessionStarted ? "Stop Chat" : "Start Chat"}
            </button>
          </div>
        </header>
      </div>
    </div>
  );
}

export default App;

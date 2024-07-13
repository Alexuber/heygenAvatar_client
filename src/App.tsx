import { useEffect, useRef, useState } from "react";
import {
  Configuration,
  NewSessionData,
  StreamingAvatarApi,
} from "@heygen/streaming-avatar";
import "./App.css";
import OpenAI from "openai";
import { CanvasRender } from "./components/canvas-render";

// Enter your OpenAI key here
const openaiApiKey = process.env.REACT_APP_OPENAI_API_KEY;
const API_KEY = process.env.REACT_APP_API_KEY;
// Set up OpenAI w/ API Key
const openai = new OpenAI({
  apiKey: openaiApiKey,
  dangerouslyAllowBrowser: true,
});

function App() {
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [text, setText] = useState<string>("");
  const [chatGPTText, setChatGPTText] = useState<string>("");
  const [avatarId, setAvatarId] = useState<string>(""); // Set your default avatar ID

  const [voiceId, setVoiceId] = useState<string>(""); // Set your default voice ID
  const [data, setData] = useState<NewSessionData>();
  const [initialized, setInitialized] = useState(false); // Track initialization
  const [recording, setRecording] = useState(false); // Track recording state
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null); // Store recorded audio
  const mediaStream = useRef<HTMLVideoElement>(null);
  const avatar = useRef<StreamingAvatarApi | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const [canPlay, setCanPlay] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false); // Track session state
  const [selectedAssistant, setSelectedAssistant] = useState<string>(""); // New state

  // async function fetchAccessToken() {
  //   try {
  //     const response = await fetch(
  //       "https://heygenavatar-server.onrender.com/get-access-token",
  //       {
  //         method: "POST",
  //       }
  //     );
  //     const result = await response.json();
  //     const token = result.token; // Access the token correctly
  //     console.log("Access Token:", token); // Log the token to verify
  //     return token;
  //   } catch (error) {
  //     console.error("Error fetching access token:", error);
  //     return "";
  //   }
  // }

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
      console.log("a",API_KEY);
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
    if (!initialized || !avatar.current) {
      setDebug("Avatar API not initialized");
      return;
    }
    await avatar.current.stopAvatar(
      { stopSessionRequest: { sessionId: data?.sessionId } },
      setDebug
    );
    setSessionStarted(false); // Set session started to false
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
        // Send the user input to ChatGPT
        model: "gpt-4",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: chatGPTText },
        ],
      });

      const chatGPTResponse = String(response.choices[0].message.content);
      console.log("ChatGPT Response:", chatGPTResponse);

      if (!initialized || !avatar.current) {
        setDebug("Avatar API not initialized");
        return;
      }

      // Send the ChatGPT response to the Streaming Avatar
      await avatar.current
        .speak({
          taskRequest: { text: chatGPTResponse, sessionId: data?.sessionId },
        })
        .catch((e) => {
          setDebug(e.message);
        });
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
      console.log(chatGPTText);
    } catch (error) {
      console.error("Error transcribing audio:", error);
    }
  };

  const handleAssistantSelect = (id: string) => {
    setAvatarId(id);
    console.log("Selected avatarId:", id); // Log selected avatar ID
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
                  </ul>{" "}
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
            <button onClick={handleChatGPT}>
              <img
                src="../send-outline-512.webp"
                alt="Send Icon"
                className="icon"
              />
            </button>
            <input
              className="InputField"
              placeholder="Let's chat!"
              value={chatGPTText}
              onChange={(v) => setChatGPTText(v.target.value)}
              autoFocus // Set focus on input field
            />
            <button onClick={recording ? stopRecording : startRecording}>
              <img
                src="https://cdn1.iconfinder.com/data/icons/creative-commons-5/20/outline_miscellaneous-microphone-1024.png"
                alt="Microphone Icon"
                className="icon"
              />
            </button>
          </div>
          <div className="Actions">
            <button
              onClick={sessionStarted ? stop : grab}
              className={`startBtn ${sessionStarted ? "stopBtn" : ""}`}
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

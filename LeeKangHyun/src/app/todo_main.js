import { FunctionComponent } from "../component/function_component.js";
import { App } from "./todo_app.js";

new FunctionComponent(App).mount(document.getElementById("root")); //App 컴포넌트를 root에 마운트한다. FunctionComponent는 컴포넌트의 인스턴스를 생성하고, mount()를 호출하면 렌더링과 DOM 삽입이 이루어진다.

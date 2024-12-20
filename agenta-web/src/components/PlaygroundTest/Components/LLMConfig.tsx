// import { RegularConfig } from '../types/parsedSchema'

// interface LLMConfigProps {
//     config: RegularConfig
//     onChange: (newValue: Record<string, any>) => void
// }

// export const LLMConfig: React.FC<LLMConfigProps> = ({ config, onChange }) => {
//     return (
//         <div>
//             {Object.entries(config.config).map(([key, property]) => (
//                 <PropertyElement
//                     key={key}
//                     property={property}
//                     value={config.value[key]}
//                     onChange={(newValue) => {
//                         onChange({ ...config.value, [key]: newValue })
//                     }}
//                 />
//             ))}
//         </div>
//     )
// }
